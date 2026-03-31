import mongoose, { Document, Schema } from 'mongoose';

export interface IJob extends Document {
  userId: mongoose.Types.ObjectId;
  promptId: mongoose.Types.ObjectId;
  topic?: string;
  generatedPrompt?: string;
  chosenSubTopic?: string;
  generatedScript?: Array<Array<{ text: string; duration?: number }>>;
  captions?: Array<Array<{ startMs: number; endMs: number; text: string }>>;
  title?: string;
  description?: string;
  hashtags?: string[];
  generatedScenes?: string[][];
  generatedMetadata?: Array<Record<string, any>>;
  pipelineConfig?: Record<string, any>;
  youtubeAccountId?: string;
  preparedContent?: Array<Record<string, any>>;
  videoUrl?: string;
  youtubeVideoId?: string;
  errorMessage?: string;
  errorStage?: 'TOKEN' | 'CONTENT_GENERATION' | 'RENDER' | 'UPLOAD';
  executionLockedAt?: Date;
  status: 'pending' | 'processing' | 'success' | 'failed';
  logs: string;
  error?: string;
  result?: any;
  progress?: {
    progress?: number;
    stage?: string;
    message?: string;
    timestamp?: string;
  };
  queuedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  holdConsumed: boolean;
  holdReleased: boolean;
  acceptedYouTubeLimitWarning: boolean;
  videoCount: number;
  processedVideos: number;
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
    topic: {
      type: String,
      trim: true,
    },
    generatedPrompt: {
      type: String,
      trim: true,
    },
    chosenSubTopic: {
      type: String,
      trim: true,
    },
    generatedScript: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    captions: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    title: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    hashtags: [{ type: String }],
    generatedScenes: {
      type: [[String]],
      default: [],
    },
    generatedMetadata: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    pipelineConfig: {
      type: Schema.Types.Mixed,
      default: {},
    },
    youtubeAccountId: {
      type: String,
    },
    preparedContent: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    videoUrl: {
      type: String,
    },
    youtubeVideoId: {
      type: String,
    },
    errorMessage: {
      type: String,
    },
    errorStage: {
      type: String,
      enum: ['TOKEN', 'CONTENT_GENERATION', 'RENDER', 'UPLOAD'],
    },
    executionLockedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'success', 'failed'],
      default: 'pending',
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
    progress: {
      type: Schema.Types.Mixed,
      default: { progress: 0 },
    },
    queuedAt: {
      type: Date,
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
    processedVideos: {
      type: Number,
      default: 0,
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

JobSchema.index({ userId: 1, createdAt: -1 });
JobSchema.index({ userId: 1, status: 1, createdAt: -1 }); // FIXED: Optimize user status history queries sorted by newest jobs.
JobSchema.index({ status: 1, holdConsumed: 1, holdReleased: 1 });

const Job = mongoose.model<IJob>('Job', JobSchema);

export default Job;
