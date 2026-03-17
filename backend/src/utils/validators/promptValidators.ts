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
  }),
});

export type GeneratePromptInput = z.infer<typeof generatePromptSchema>['body'];
