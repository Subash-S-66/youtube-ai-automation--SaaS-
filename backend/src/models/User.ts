import mongoose, { Document, Schema } from 'mongoose';

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
  uploadLimitPerDay: number;
  uploadsUsedToday: number;
  lastUploadReset: Date;
  youtubeTokens?: IYoutubeTokens;
  isYoutubeConnected: boolean;
  telegramChatId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const YoutubeTokensSchema = new Schema<IYoutubeTokens>(
  {
    access_token: { type: String },
    refresh_token: { type: String },
    expiry_date: { type: Number },
  },
  { _id: false }
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
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model<IUser>('User', UserSchema);

export default User;
