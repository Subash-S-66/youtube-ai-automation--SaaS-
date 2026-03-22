import { z } from 'zod';

export const createScheduleSchema = z.object({
  body: z.object({
    channelId: z.string({
      message: 'channelId is required',
    }),
    type: z.enum(['one-time', 'interval', 'recurring']),
    datetime: z.coerce.date().optional(),
    intervalHours: z.number().int().min(1).max(24).optional(),
    videosPerInterval: z.number().int().min(1).max(10).optional(),
    cron_expression: z.string().optional(),
    videoConfig: z.object({
      promptId: z.string({
        message: 'promptId is required',
      }),
    }).passthrough(),
  }),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>['body'];
