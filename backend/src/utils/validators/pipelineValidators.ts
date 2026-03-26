import { z } from 'zod';

export const runPipelineSchema = z.object({
  body: z.object({
    promptId: z.string().optional(),
    title: z.string().trim().min(1).max(500).optional(),
    prompt: z.string().trim().min(1).max(5000).optional(),
    videoSize: z.string().trim().min(1).max(20).optional(),
    duration: z.number().optional(),
    tone: z.string().trim().min(1).max(100).optional(),
    style: z.string().trim().min(1).max(100).optional(),
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
      }).optional(),
      customVideoIds: z.array(z.string().max(100)).max(50).optional(),
      customImageIds: z.array(z.string().max(100)).max(50).optional(),
      customThumbnailId: z.string().max(100).optional(),
    }, {
      message: 'settings are required',
    }),
    acceptedYouTubeLimitWarning: z.boolean().optional(),
  }).superRefine((data, ctx) => {
    const hasPromptId = !!data.promptId;
    const hasTitle = !!data.title;
    const hasPrompt = !!data.prompt;

    if (!hasPromptId && !hasTitle && !hasPrompt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either promptId or one of title/prompt.',
        path: ['promptId'],
      });
    }
  }),
});

export type RunPipelineInput = z.infer<typeof runPipelineSchema>['body'];
