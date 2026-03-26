import mongoose, { Document, Schema } from 'mongoose';

export interface IJob extends Document {
  userId: mongoose.Types.ObjectId;
  promptId: mongoose.Types.ObjectId;
  status: 'queued' | 'processing' | 'running' | 'completed' | 'failed' | 'paused_due_to_limit' | 'skipped_due_to_limit';
  logs: string;
  error?: string;
  result?: any;
  startedAt?: Date;
  completedAt?: Date;
  holdConsumed: boolean;
  holdReleased: boolean;
  acceptedYouTubeLimitWarning: boolean;
  videoCount: number;
  channelId: string;
  customVideoIds?: string[];
  customImageIds?: string[];
  customThumbnailId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const JobSchema = new Schema<IJob>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    promptId: {
      type: Schema.Types.ObjectId,
      ref: 'Prompt',
      required: true,
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'running', 'completed', 'failed', 'paused_due_to_limit', 'skipped_due_to_limit'],
      default: 'queued',
    },
    logs: {
      type: String,
      default: '',
    },
    error: {
      type: String,
    },
    result: {
      type: Schema.Types.Mixed,
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    holdConsumed: {
      type: Boolean,
      default: false,
    },
    holdReleased: {
      type: Boolean,
      default: false,
    },
    acceptedYouTubeLimitWarning: {
      type: Boolean,
      default: false,
    },
    videoCount: {
      type: Number,
      default: 1,
    },
    channelId: {
      type: String,
      required: true,
    },
    customVideoIds: [{ type: String }],
    customImageIds: [{ type: String }],
    customThumbnailId: { type: String },
  },
  {
    timestamps: true,
  }
);

// Optimize lookups for pending/running jobs per user
JobSchema.index({ userId: 1, status: 1 });
JobSchema.index({ userId: 1, _id: -1 }); // Index for cursor pagination

const Job = mongoose.model<IJob>('Job', JobSchema);

export default Job;
