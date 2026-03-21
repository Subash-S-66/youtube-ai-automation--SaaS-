import Schedule from '../models/Schedule';
import { enqueuePipelineJob } from '../services/pipelineRunService';

const RUN_INTERVAL_MS = 60 * 1000;
let started = false;

export const startScheduleRunner = () => {
  if (started) return;
  started = true;

  const tick = async () => {
    const now = new Date();
    try {
      const dueSchedules = await Schedule.find({
        enabled: true,
        running: false,
        nextRunAt: { $lte: now },
      }).limit(25);

      for (const schedule of dueSchedules) {
        const claimed = await Schedule.findOneAndUpdate(
          { _id: schedule._id, running: false },
          { $set: { running: true } },
          { new: true }
        );

        if (!claimed) {
          continue;
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
          const intervalHours = claimed.intervalHours || 1;
          update.nextRunAt = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
        }

        await Schedule.findByIdAndUpdate(claimed._id, update);
      }
    } catch (error) {
      console.error('[ScheduleRunner] Failed to process schedules', error);
    }
  };

  tick();
  setInterval(tick, RUN_INTERVAL_MS);
};
