import { z } from 'zod';

export const runPipelineSchema = z.object({
  body: z.object({
    promptId: z.string({
      message: 'promptId is required',
    }),
    settings: z.object({
      duration: z.number({
        message: 'duration is required',
      }),
      contentType: z.enum(['clips', 'images', 'mixed'], {
        message: "contentType must be one of: 'clips', 'images', 'mixed'",
      }),
      videoCount: z.number({
        message: 'videoCount is required',
      }),
    }, {
      message: 'settings are required',
    }),
  }),
});

export type RunPipelineInput = z.infer<typeof runPipelineSchema>['body'];
