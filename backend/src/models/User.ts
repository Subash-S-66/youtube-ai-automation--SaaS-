import mongoose, { Document, Schema } from 'mongoose';
import { encrypt, decrypt } from '../utils/encryption';

export interface IYoutubeTokens {
  access_token?: string | undefined;
  refresh_token?: string | undefined;
  expiry_date?: number | undefined;
}

export interface IYoutubeChannel {
  channelId: string;
  channelName: string;
  tokens: IYoutubeTokens;
  videosOnHold: number;
  blockedUntil?: Date;
}

import { PlanType } from '../config/plans';

export interface IUser extends Document {
  email: string;
  password?: string;
  role: string;
  plan: PlanType;
  subscriptionExpiresAt?: Date;
  subscriptionStatus: 'active' | 'inactive';
  stripeCustomerId?: string;
  uploadLimitPerDay: number;
  uploadsUsedToday: number;
  uploadsOnHold: number;
  lastUploadReset: Date;
  youtubeChannels: IYoutubeChannel[];
  isYoutubeConnected: boolean;
  telegramChatId?: string;
  fcmToken?: string | undefined;
  emailNotificationsEnabled: boolean;
  telegramNotificationsEnabled: boolean;
  pushNotificationsEnabled: boolean;
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

const YoutubeChannelSchema = new Schema<IYoutubeChannel>(
  {
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    tokens: { type: YoutubeTokensSchema, required: true },
    videosOnHold: { type: Number, default: 0 },
    blockedUntil: { type: Date },
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
      enum: ['user', 'admin'],
      default: 'user',
    },
    plan: {
      type: String,
      enum: ['free', 'basic', 'pro', 'premium'],
      default: 'free',
    },
    subscriptionExpiresAt: {
      type: Date,
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
    uploadsOnHold: {
      type: Number,
      default: 0,
    },
    lastUploadReset: {
      type: Date,
      default: Date.now,
    },
    youtubeChannels: {
      type: [YoutubeChannelSchema],
      default: [],
    },
    isYoutubeConnected: {
      type: Boolean,
      default: false,
    },
    telegramChatId: {
      type: String,
    },
    fcmToken: {
      type: String,
    },
    emailNotificationsEnabled: {
      type: Boolean,
      default: true,
    },
    telegramNotificationsEnabled: {
      type: Boolean,
      default: true,
    },
    pushNotificationsEnabled: {
      type: Boolean,
      default: true,
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
