import mongoose, { Document, Schema } from 'mongoose';

export interface IJob extends Document {
  userId: mongoose.Types.ObjectId;
  promptId: mongoose.Types.ObjectId;
  status: 'pending' | 'running' | 'success' | 'failed';
  logs: string;
  acceptedYouTubeLimitWarning: boolean;
  videoCount: number;
  channelId: string;
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
      enum: ['pending', 'running', 'success', 'failed'],
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
  },
  {
    timestamps: true,
  }
);

// Optimize lookups for pending/running jobs per user
JobSchema.index({ userId: 1, status: 1 });

const Job = mongoose.model<IJob>('Job', JobSchema);

export default Job;
