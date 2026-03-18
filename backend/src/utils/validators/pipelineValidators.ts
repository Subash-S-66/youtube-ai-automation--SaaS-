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
      storyMode: z.boolean().optional(),
      storyId: z.string().optional(),
      currentPart: z.number().optional(),
      recapEnabled: z.boolean().optional(),
      ctaEnabled: z.boolean().optional(),
      voices: z.array(z.string()).optional(),
      resetStory: z.boolean().optional(),
    }, {
      message: 'settings are required',
    }),
    acceptedYouTubeLimitWarning: z.boolean().optional(),
  }),
});

export type RunPipelineInput = z.infer<typeof runPipelineSchema>['body'];
