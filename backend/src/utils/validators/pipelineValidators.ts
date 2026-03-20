import { z } from 'zod';

export const runPipelineSchema = z.object({
  body: z.object({
    promptId: z.string({
      message: 'promptId is required',
    }),
    settings: z.object({
      targetDuration: z.number().optional().default(40),
      duration: z.number().optional(),
      contentType: z.enum(['clips', 'images', 'mixed']).optional().default('clips'),
      videoCount: z.number({
        message: 'videoCount is required',
      }).max(10, 'Maximum 10 videos per request'),
      channelId: z.string({
        message: 'channelId is required',
      }),
      storyMode: z.boolean().optional(),
      storyId: z.string().optional(),
      currentPart: z.number().optional(),
      recapEnabled: z.boolean().optional(),
      ctaEnabled: z.boolean().optional(),
      voices: z.array(z.string()).optional(),
      resetStory: z.boolean().optional(),
      userMediaPaths: z.array(z.string()).optional(),
      lastPrompt: z.string().optional(),
      templateConfig: z.object({
         fontStyle: z.string().optional(),
         subtitleColor: z.string().optional()
      }).optional()
    }, {
      message: 'settings are required',
    }),
    acceptedYouTubeLimitWarning: z.boolean().optional(),
  }),
});

export type RunPipelineInput = z.infer<typeof runPipelineSchema>['body'];
