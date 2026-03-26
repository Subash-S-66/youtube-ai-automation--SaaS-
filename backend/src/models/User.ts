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
  isValid?: boolean;
  lastLimitWarningSentAt?: Date;
  status?: string;
  createdAt?: Date;
}

import { PlanType } from '../config/plans';

export interface IUser extends Document {
  email: string;
  password?: string;
  provider: 'local' | 'google';
  googleId?: string;
  profileImage?: string;
  role: string;
  plan: PlanType;
  subscriptionExpiresAt?: Date;
  subscriptionStatus: 'active' | 'inactive';
  cancelAtPeriodEnd: boolean;
  stripeCustomerId?: string;
  referralCode: string;
  referredBy?: string;
  referralRewardGiven: boolean;
  uploadLimitPerDay: number;
  uploadsUsedToday: number;
  uploadsOnHold: number;
  lastUploadReset: Date;
  youtubeChannels: IYoutubeChannel[];
  isYoutubeConnected: boolean;
  templateFont?: string;
  templateColor?: string;
  lastInputMode?: 'topic' | 'prompt';
  lastPrompt?: string;
  lastSelectedTopic?: string;
  lastCustomTopic?: string;
  lastChannelInputs?: Record<string, {
    inputMode?: 'topic' | 'prompt';
    prompt?: string;
    selectedTopic?: string;
    customTopic?: string;
  }>;
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
  otpToken?: string | undefined;
  otpExpires?: Date | undefined;
  otpAttempts?: number | undefined;
  otpLockUntil?: Date | undefined;
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
    isValid: { type: Boolean, default: true },
    lastLimitWarningSentAt: { type: Date },
    status: { type: String, default: 'active', enum: ['active', 'disabled_due_to_plan'] },
    createdAt: { type: Date, default: Date.now },
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
      required: function (this: IUser) {
        return this.provider === 'local';
      },
    },
    provider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },
    googleId: {
      type: String,
    },
    profileImage: {
      type: String,
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
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    stripeCustomerId: {
      type: String,
    },
    referralCode: {
      type: String,
      unique: true,
    },
    referredBy: {
      type: String,
    },
    referralRewardGiven: {
      type: Boolean,
      default: false,
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
    templateFont: {
      type: String,
      default: 'Arial',
    },
    templateColor: {
      type: String,
      default: '#FFFFFF',
    },
    lastInputMode: {
      type: String,
      enum: ['topic', 'prompt'],
    },
    lastPrompt: {
      type: String,
    },
    lastSelectedTopic: {
      type: String,
    },
    lastCustomTopic: {
      type: String,
    },
    lastChannelInputs: {
      type: Schema.Types.Mixed,
      default: {},
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
    otpToken: {
      type: String,
    },
    otpExpires: {
      type: Date,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    otpLockUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.index({ email: 1 });
UserSchema.index({ emailVerificationToken: 1 });
UserSchema.index({ passwordResetToken: 1 });
UserSchema.index({ otpToken: 1 });

const User = mongoose.model<IUser>('User', UserSchema);

export default User;
