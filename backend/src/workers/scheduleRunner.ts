import { Worker, Job as BullJob } from 'bullmq';
import { acquireLock, releaseLock } from '../utils/redisLock';
import { connection } from '../config/redis';
import Schedule from '../models/Schedule';
import { enqueuePipelineJob } from '../services/pipelineRunService';
import { scheduleQueue, ScheduleJobPayload } from '../queues/scheduleQueue';

let started = false;
let scheduleWorker: Worker | null = null;

export const startScheduleRunner = async () => {
  if (started) return;
  started = true;
  console.log('[ScheduleRunner] Worker Started');

  // Seed orphaned schedules into the queue (one-time check to migrate from polling)
  try {
    const orphanedSchedules = await Schedule.find({ enabled: true, running: false });
    let queuedCount = 0;
    for (const schedule of orphanedSchedules) {
      if (schedule.nextRunAt) {
        // Double check if it's already in the queue to avoid duplicate jobs if we restart worker frequently
        const existingJobs = await scheduleQueue.getJobs(['delayed', 'waiting']);
        const isQueued = existingJobs.some((j: any) => j.data.scheduleId === schedule._id.toString());

        if (!isQueued) {
          await scheduleQueue.add(
            'runSchedule',
            { scheduleId: schedule._id.toString() },
            {
              delay: Math.max(0, schedule.nextRunAt.getTime() - Date.now()),
              jobId: `schedule-${schedule._id.toString()}-${schedule.nextRunAt.getTime()}`
            }
          );
          queuedCount++;
        }
      }
    }
    if (queuedCount > 0) {
      console.log(`[ScheduleRunner] Seeded ${queuedCount} missing schedules into BullMQ.`);
    }
  } catch (seedErr) {
    console.error('[ScheduleRunner] Failed to seed existing schedules on startup:', seedErr);
  }

  scheduleWorker = new Worker<ScheduleJobPayload>(
    'scheduleQueue',
    async (job: BullJob) => {
      const { scheduleId } = job.data;

      const lockKey = `lock:schedule:${scheduleId}`;
      const acquired = await acquireLock(lockKey, 60); // 1 minute TTL
      if (!acquired) {
        console.warn(`[ScheduleRunner] Schedule ${scheduleId} is currently being processed by another worker. Throwing error to trigger BullMQ retry.`);
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
      };

      if (lastJobId) {
        update.lastJobId = lastJobId;
      }

      if (claimed.type === 'one-time') {
        update.enabled = false;
      } else {
        const intervalHours = claimed.intervalHours;
        if (!intervalHours || intervalHours <= 0) {
          update.lastError = update.lastError || 'Recurring schedule requires intervalHours';
          update.nextRunAt = new Date(now.getTime() + 60 * 60 * 1000);
        } else {
          const nextRunTime = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
          update.nextRunAt = nextRunTime;

          // Enqueue the next run before updating the DB to prevent race condition stalling
          let enqueued = false;
          let attempts = 0;
          while (!enqueued && attempts < 3) {
            attempts++;
            try {
              await scheduleQueue.add(
                'runSchedule',
                { scheduleId: claimed._id.toString() },
                {
                  delay: Math.max(0, nextRunTime.getTime() - Date.now()),
                  jobId: `schedule-${claimed._id.toString()}-${nextRunTime.getTime()}`
                }
              );
              enqueued = true;
            } catch (qErr: any) {
              console.error(`[ScheduleRunner] Attempt ${attempts}: Failed to enqueue next run for ${claimed._id}`, qErr);
              if (attempts === 3) {
                update.lastError = `Failed to queue next run after 3 attempts: ${qErr.message}`;
              } else {
                await new Promise(res => setTimeout(res, 2000 * attempts)); // exponential backoff
              }
            }
          }
        }
      }

      await Schedule.findByIdAndUpdate(claimed._id, update);
      } finally {
        await releaseLock(lockKey).catch((err) => console.error(`[ScheduleRunner] Failed to release lock for ${scheduleId}:`, err));
      }
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
