import mongoose, { Document, Schema } from 'mongoose';
import { encrypt, decrypt } from '../utils/encryption';

export interface IYoutubeTokens {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}

export interface IUser extends Document {
  email: string;
  password?: string;
  role: string;
  plan: 'free' | 'pro';
  subscriptionStatus: 'active' | 'inactive';
  stripeCustomerId?: string;
  uploadLimitPerDay: number;
  uploadsUsedToday: number;
  lastUploadReset: Date;
  youtubeTokens?: IYoutubeTokens;
  isYoutubeConnected: boolean;
  telegramChatId?: string;
  isEmailVerified: boolean;
  emailVerificationToken?: string | undefined;
  emailVerificationExpires?: Date | undefined;
  passwordResetToken?: string | undefined;
  passwordResetExpires?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const YoutubeTokensSchema = new Schema<IYoutubeTokens>(
  {
    access_token: {
      type: String,
      set: (token: string) => encrypt(token),
      get: (token: string) => decrypt(token),
    },
    refresh_token: {
      type: String,
      set: (token: string) => encrypt(token),
      get: (token: string) => decrypt(token),
    },
    expiry_date: { type: Number },
  },
  { _id: false, toJSON: { getters: true }, toObject: { getters: true } }
);

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      default: 'user',
    },
    plan: {
      type: String,
      enum: ['free', 'pro'],
      default: 'free',
    },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'inactive',
    },
    stripeCustomerId: {
      type: String,
    },
    uploadLimitPerDay: {
      type: Number,
      default: 3,
    },
    uploadsUsedToday: {
      type: Number,
      default: 0,
    },
    lastUploadReset: {
      type: Date,
      default: Date.now,
    },
    youtubeTokens: {
      type: YoutubeTokensSchema,
    },
    isYoutubeConnected: {
      type: Boolean,
      default: false,
    },
    telegramChatId: {
      type: String,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
    },
    emailVerificationExpires: {
      type: Date,
    },
    passwordResetToken: {
      type: String,
    },
    passwordResetExpires: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model<IUser>('User', UserSchema);

export default User;
