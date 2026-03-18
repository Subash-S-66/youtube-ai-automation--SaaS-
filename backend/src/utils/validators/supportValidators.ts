import { z } from 'zod';

export const createSupportTicketSchema = z.object({
  body: z.object({
    subject: z.string({
      required_error: 'Subject is required',
    } as any).min(1, 'Subject cannot be empty').max(100, 'Subject is too long'),
    message: z.string({
      required_error: 'Message is required',
    } as any).min(10, 'Message must be at least 10 characters long').max(2000, 'Message is too long'),
  }),
});

export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>['body'];
