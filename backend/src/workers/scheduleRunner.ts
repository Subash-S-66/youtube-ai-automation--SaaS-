import { Worker, Job as BullJob } from 'bullmq';
import { connection } from '../config/redis';
import Schedule from '../models/Schedule';
import { enqueuePipelineJob } from '../services/pipelineRunService';
import { scheduleQueue, ScheduleJobPayload } from '../queues/scheduleQueue';

let started = false;
let scheduleWorker: Worker | null = null;

export const startScheduleRunner = () => {
  if (started) return;
  started = true;
  console.log('[ScheduleRunner] Worker Started');

  scheduleWorker = new Worker<ScheduleJobPayload>(
    'scheduleQueue',
    async (job: BullJob) => {
      const { scheduleId } = job.data;
      const now = new Date();

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

          // Enqueue the next run
          await scheduleQueue.add(
            'runSchedule',
            { scheduleId: claimed._id.toString() },
            {
              delay: nextRunTime.getTime() - Date.now(),
              jobId: `schedule-${claimed._id.toString()}-${nextRunTime.getTime()}`
            }
          );
        }
      }

      await Schedule.findByIdAndUpdate(claimed._id, update);
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
