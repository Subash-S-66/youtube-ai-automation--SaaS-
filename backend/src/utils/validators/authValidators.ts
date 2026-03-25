import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    referralCode: z.string().optional(),
    email: z
      .string({
        message: 'Email is required',
      })
      .email('Invalid email format'),
    password: z
      .string({
        message: 'Password is required',
      })
      .min(8, 'Password must be at least 8 characters long')
      .regex(
        /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*?&]/,
        'Password must contain at least one letter and one number'
      ),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    referralCode: z.string().optional(),
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

export const adminLoginSchema = z.object({
  body: z.object({
    username: z.string({
      message: 'Username is required',
    }),
    password: z.string({
      message: 'Password is required',
    }),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    referralCode: z.string().optional(),
    email: z
      .string({
        message: 'Email is required',
      })
      .email('Invalid email format'),
  }),
});

export const sendOtpSchema = z.object({
  body: z.object({
    email: z
      .string({
        message: 'Email is required',
      })
      .email('Invalid email format'),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    email: z
      .string({
        message: 'Email is required',
      })
      .email('Invalid email format'),
    otp: z
      .string({
        message: 'OTP is required',
      })
      .length(6, 'OTP must be exactly 6 digits'),
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

export const resendVerificationSchema = z.object({
  body: z.object({
    referralCode: z.string().optional(),
    email: z
      .string({
        message: 'Email is required',
      })
      .email('Invalid email format'),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type AdminLoginInput = z.infer<typeof adminLoginSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>['body'];
export type SendOtpInput = z.infer<typeof sendOtpSchema>['body'];
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>['body'];
