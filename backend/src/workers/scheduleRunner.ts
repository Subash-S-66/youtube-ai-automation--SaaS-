import { Worker, Job as BullJob } from 'bullmq';
import { acquireLock, releaseLock } from '../utils/redisLock';
import { connection, redisEnabled } from '../config/redis';
import Schedule from '../models/Schedule';
import { enqueuePipelineJob } from '../services/pipelineRunService';
import { scheduleQueue, ScheduleJobPayload } from '../queues/scheduleQueue';

const SCHEDULE_QUEUE_STATES: Array<'waiting' | 'delayed'> = ['waiting', 'delayed'];
const FALLBACK_POLL_MS = 30_000;

const clearQueuedScheduleJobs = async (scheduleId: string): Promise<void> => {
  const jobs = await scheduleQueue.getJobs(SCHEDULE_QUEUE_STATES);
  const matching = jobs.filter((job: any) => job?.data?.scheduleId === scheduleId);
  await Promise.all(matching.map((job: any) => job.remove().catch(() => undefined)));
};

const enqueueNextScheduleRun = async (scheduleId: string, nextRunTime: Date): Promise<void> => {
  if (!redisEnabled || !connection) {
    return;
  }

  await clearQueuedScheduleJobs(scheduleId);
  await scheduleQueue.add(
    'runSchedule',
    { scheduleId },
    {
      delay: Math.max(0, nextRunTime.getTime() - Date.now()),
      jobId: `schedule-${scheduleId}-${nextRunTime.getTime()}`,
    }
  );
};

let started = false;
let scheduleWorker: Worker | null = null;
let fallbackPollHandle: ReturnType<typeof setInterval> | null = null;

const processSchedule = async (scheduleId: string): Promise<void> => {
  const lockKey = `lock:schedule:${scheduleId}`;
  const acquired = await acquireLock(lockKey, 60); // 1 minute TTL
  if (!acquired) {
    throw new Error(`Schedule ${scheduleId} is locked by another instance.`);
  }

  const now = new Date();

  try {
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule || !schedule.enabled) {
      return; // Skip if disabled or deleted
    }

    // Claim it to prevent race condition if same job pushed twice
    const claimed = await Schedule.findOneAndUpdate(
      { _id: schedule._id, running: false },
      { $set: { running: true } },
      { returnDocument: 'after' }
    );

    if (!claimed) {
      return; // Already running
    }

    const baseConfig = claimed.videoConfig || {};
    const promptId = baseConfig.promptId;
    const settings = {
      ...baseConfig,
      channelId: claimed.channelId,
      videoCount: claimed.type === 'interval'
        ? (claimed.videosPerInterval || baseConfig.videoCount || 1)
        : (baseConfig.videoCount || 1),
    };

    let lastError = '';
    let lastJobId: string | undefined;

    try {
      if (!promptId) {
        throw new Error('Missing promptId for schedule');
      }

      const result = await enqueuePipelineJob({
        userId: claimed.userId.toString(),
        promptId,
        settings,
        acceptedYouTubeLimitWarning: true,
      });

      lastJobId = result.jobId;
    } catch (error: any) {
      lastError = error?.message || 'Failed to enqueue scheduled job';
    }

    const update: Record<string, any> = {
      running: false,
      lastRunAt: now,
      lastError: lastError || undefined,
      status: lastError ? 'failed' : 'pending',
    };

    if (lastJobId) {
      update.lastJobId = lastJobId;
    }

    if (claimed.type === 'one-time') {
      update.enabled = false;
      update.status = lastError ? 'failed' : 'completed';
      update.nextRunAt = undefined;
    } else {
      const intervalHours = claimed.intervalHours;
      if (!intervalHours || intervalHours <= 0) {
        update.lastError = update.lastError || 'Recurring schedule requires intervalHours';
        update.status = 'failed';
        update.nextRunAt = new Date(now.getTime() + 60 * 60 * 1000);
      } else {
        const nextRunTime = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
        update.nextRunAt = nextRunTime;

        if (redisEnabled && connection) {
          let enqueued = false;
          let attempts = 0;
          while (!enqueued && attempts < 3) {
            attempts++;
            try {
              await enqueueNextScheduleRun(claimed._id.toString(), nextRunTime);
              enqueued = true;
            } catch (qErr: any) {
              console.error(`[ScheduleRunner] Attempt ${attempts}: Failed to enqueue next run for ${claimed._id}`, qErr);
              if (attempts === 3) {
                update.lastError = `Failed to queue next run after 3 attempts: ${qErr.message}`;
                update.status = 'failed';
              } else {
                await new Promise(res => setTimeout(res, 2000 * attempts)); // exponential backoff
              }
            }
          }
        }
      }
    }

    await Schedule.findByIdAndUpdate(claimed._id, update);
  } finally {
    await releaseLock(lockKey).catch((err) => console.error(`[ScheduleRunner] Failed to release lock for ${scheduleId}:`, err));
  }
};

const seedQueuedSchedules = async (): Promise<void> => {
  if (!redisEnabled || !connection) {
    return;
  }

  const orphanedSchedules = await Schedule.find({ enabled: true, running: false });
  let queuedCount = 0;
  for (const schedule of orphanedSchedules) {
    if (!schedule.nextRunAt) {
      continue;
    }

    const existingJobs = await scheduleQueue.getJobs(SCHEDULE_QUEUE_STATES);
    const isQueued = existingJobs.some((j: any) => j?.data?.scheduleId === schedule._id.toString());

    if (!isQueued) {
      await scheduleQueue.add(
        'runSchedule',
        { scheduleId: schedule._id.toString() },
        {
          delay: Math.max(0, schedule.nextRunAt.getTime() - Date.now()),
          jobId: `schedule-${schedule._id.toString()}-${schedule.nextRunAt.getTime()}`,
        }
      );
      queuedCount++;
    }
  }
  if (queuedCount > 0) {
    console.log(`[ScheduleRunner] Seeded ${queuedCount} missing schedules into BullMQ.`);
  }
};

const runFallbackDueScheduleScan = async (): Promise<void> => {
  const now = new Date();
  const dueSchedules = await Schedule.find({
    enabled: true,
    running: false,
    nextRunAt: { $lte: now },
  })
    .sort({ nextRunAt: 1 })
    .limit(50)
    .select('_id');

  for (const schedule of dueSchedules) {
    try {
      await processSchedule(schedule._id.toString());
    } catch (err) {
      console.error(`[ScheduleRunner] Fallback run failed for ${schedule._id.toString()}:`, err);
    }
  }
};

export const startScheduleRunner = async () => {
  if (started) return;
  started = true;
  console.log('[ScheduleRunner] Worker Started');

  if (!redisEnabled || !connection) {
    console.warn('[ScheduleRunner] Redis not configured. Using fallback DB polling mode.');
    await runFallbackDueScheduleScan();
    fallbackPollHandle = setInterval(() => {
      void runFallbackDueScheduleScan();
    }, FALLBACK_POLL_MS);
    return;
  }

  // Seed orphaned schedules into the queue (one-time check to migrate from polling)
  try {
    await seedQueuedSchedules();
  } catch (seedErr) {
    console.error('[ScheduleRunner] Failed to seed existing schedules on startup:', seedErr);
  }

  scheduleWorker = new Worker<ScheduleJobPayload>(
    'scheduleQueue',
    async (job: BullJob<ScheduleJobPayload>) => {
      const { scheduleId } = job.data;
      await processSchedule(scheduleId);
    },
    {
      connection: connection as any,
      concurrency: 5
    }
  );

  scheduleWorker.on('failed', (job, err) => {
    console.error(`[ScheduleRunner] Job failed: ${job?.id}`, err);
  });
};
