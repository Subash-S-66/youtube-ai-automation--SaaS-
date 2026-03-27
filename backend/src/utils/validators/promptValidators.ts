import { z } from 'zod';

export const generatePromptSchema = z.object({
  body: z.object({
    user_prompt: z
      .string({
        message: 'Prompt is required',
      })
      .trim()
      .min(1, 'Prompt cannot be empty')
      .max(500, 'Prompt must be less than 500 characters'),
    targetDuration: z.number().int().min(15).max(60).optional(),
    ctaEnabled: z.boolean().optional(),
    recapEnabled: z.boolean().optional(),
    storyMode: z.boolean().optional(),
    currentPart: z.number().int().min(1).optional(),
    storyId: z.string().trim().max(120).optional(),
    videoCount: z.number().int().min(1).max(10).optional(),
    videoStyle: z.string().trim().max(120).optional(),
    tone: z.string().trim().max(120).optional(),
    templateConfig: z.object({
      fontStyle: z.string().trim().max(80).optional(),
      subtitleColor: z.string().trim().max(20).optional(),
    }).optional(),
  }),
});

export type GeneratePromptInput = z.infer<typeof generatePromptSchema>['body'];
