import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z
      .string({
        message: 'Email is required',
      })
      .email('Invalid email format'),
    password: z
      .string({
        message: 'Password is required',
      })
      .min(6, 'Password must be at least 6 characters long'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string({
        message: 'Email is required',
      })
      .email('Invalid email format'),
    password: z
      .string({
        message: 'Password is required',
      }),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z
      .string({
        message: 'Email is required',
      })
      .email('Invalid email format'),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z
      .string({
        message: 'Token is required',
      }),
    newPassword: z
      .string({
        message: 'Password is required',
      })
      .min(6, 'Password must be at least 6 characters long'),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];
