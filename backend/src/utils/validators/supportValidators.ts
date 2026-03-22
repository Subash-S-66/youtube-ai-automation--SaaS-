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

export const replySupportTicketSchema = z.object({
  body: z.object({
    message: z.string({
      required_error: 'Message is required',
    } as any).min(3, 'Reply must be at least 3 characters long').max(2000, 'Reply is too long'),
    closeTicket: z.boolean().optional(),
  }),
});

export type ReplySupportTicketInput = z.infer<typeof replySupportTicketSchema>['body'];
