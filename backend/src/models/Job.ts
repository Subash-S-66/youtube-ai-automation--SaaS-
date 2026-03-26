import mongoose, { Document, Schema } from 'mongoose';

export interface IJob extends Document {
  userId: mongoose.Types.ObjectId;
  promptId: mongoose.Types.ObjectId;
  status: 'pending' | 'running' | 'success' | 'failed' | 'paused_due_to_limit' | 'skipped_due_to_limit';
  logs: string;
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
    },
    promptId: {
      type: Schema.Types.ObjectId,
      ref: 'Prompt',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'success', 'failed', 'paused_due_to_limit', 'skipped_due_to_limit'],
      default: 'pending',
    },
    logs: {
      type: String,
      default: '',
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
