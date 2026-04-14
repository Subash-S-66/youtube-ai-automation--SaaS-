import mongoose, { Document, Schema } from 'mongoose';

export interface ISystemConfig extends Document {
  betaMode: boolean;
  geminiModel?: string;
  pipelineRunner?: 'local' | 'azure' | 'remote';
  pipelineServiceUrl?: string;
  pipelineServiceSecret?: string;
  pipelineRunnerPinned?: boolean;
  runEmbeddedWorker?: boolean;
  autoStartEmbeddedWorkerWhenMissing?: boolean;
  includeEmbeddedWorkersInRuntimeStatus?: boolean;
  pipelineWorkerProfile?: 'local' | 'vm' | 'cloud';
  pipelineWorkerConcurrency?: number | null;
  pipelineConcurrencyByPlan?: {
    free: number;
    basic: number;
    pro: number;
    premium: number;
  };
  pipelineRetriesByPlan?: {
    free: number;
    basic: number;
    pro: number;
    premium: number;
  };
  pipelineRetryCycles?: number;
  pipelineCycleAcrossRunners?: boolean;
  pipelineRunnerFallbackOrder?: Array<'local' | 'azure' | 'remote'>;
  planLimits?: {
    free: number;
    basic: number;
    pro: number;
    premium: number;
  };
  planValueMap?: {
    free: number;
    basic: number;
    pro: number;
    premium: number;
  };
  jobHistoryLimitByPlan?: {
    free: number;
    basic: number;
    pro: number;
    premium: number;
  };
  jobHistoryMinAgeDays?: number;
  queueWaitTimeoutMinutes?: number;
  processingHardTimeoutMinutes?: number;
  perVideoTimeoutMs: number;
  baseTimeoutMs: number;
  updatedAt: Date;
}

const SystemConfigSchema = new Schema<ISystemConfig>(
  {
    betaMode: {
      type: Boolean,
      default: false,
    },
    geminiModel: {
      type: String,
      default: 'gemini-3.1-flash-lite-preview',
      trim: true,
      maxlength: 120,
    },
    pipelineRunner: {
      type: String,
      enum: ['local', 'azure', 'remote'],
      default: 'local',
    },
    pipelineServiceUrl: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    pipelineServiceSecret: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    pipelineRunnerPinned: {
      type: Boolean,
      default: false,
    },
    runEmbeddedWorker: {
      type: Boolean,
      default: false,
    },
    autoStartEmbeddedWorkerWhenMissing: {
      type: Boolean,
      default: false,
    },
    includeEmbeddedWorkersInRuntimeStatus: {
      type: Boolean,
      default: false,
    },
    pipelineWorkerProfile: {
      type: String,
      enum: ['local', 'vm', 'cloud'],
      default: 'local',
    },
    pipelineWorkerConcurrency: {
      type: Number,
      default: null,
      min: 1,
      max: 32,
    },
    pipelineConcurrencyByPlan: {
      free: { type: Number, default: 2, min: 1, max: 100 },
      basic: { type: Number, default: 5, min: 1, max: 100 },
      pro: { type: Number, default: 10, min: 1, max: 100 },
      premium: { type: Number, default: 20, min: 1, max: 100 },
    },
    pipelineRetriesByPlan: {
      free: { type: Number, default: 2, min: 0, max: 10 },
      basic: { type: Number, default: 3, min: 0, max: 10 },
      pro: { type: Number, default: 3, min: 0, max: 10 },
      premium: { type: Number, default: 5, min: 0, max: 10 },
    },
    pipelineRetryCycles: {
      type: Number,
      default: 2,
      min: 1,
      max: 10,
    },
    pipelineCycleAcrossRunners: {
      type: Boolean,
      default: true,
    },
    pipelineRunnerFallbackOrder: {
      type: [String],
      default: ['azure', 'remote', 'local'],
      validate: {
        validator: (values: string[]) =>
          Array.isArray(values) && values.every((value) => ['local', 'azure', 'remote'].includes(value)),
      },
    },
    planLimits: {
      free: { type: Number, default: 2 },
      basic: { type: Number, default: 10 },
      pro: { type: Number, default: 25 },
      premium: { type: Number, default: 100 },
    },
    planValueMap: {
      free: { type: Number, default: 0 },
      basic: { type: Number, default: 1 },
      pro: { type: Number, default: 2 },
      premium: { type: Number, default: 4 },
    },
    jobHistoryLimitByPlan: {
      free: { type: Number, default: 10, min: 1, max: 5000 },
      basic: { type: Number, default: 50, min: 1, max: 5000 },
      pro: { type: Number, default: 100, min: 1, max: 5000 },
      premium: { type: Number, default: 200, min: 1, max: 5000 },
    },
    jobHistoryMinAgeDays: {
      type: Number,
      default: 7,
      min: 1,
      max: 3650,
    },
    queueWaitTimeoutMinutes: {
      type: Number,
      default: 100,
      min: 5,
      max: 1440,
    },
    processingHardTimeoutMinutes: {
      type: Number,
      default: 100,
      min: 10,
      max: 1440,
    },
    perVideoTimeoutMs: {
      type: Number,
      default: 6 * 60 * 1000, // 6 minutes
    },
    baseTimeoutMs: {
      type: Number,
      default: 2 * 60 * 1000, // 2 minutes
    },
  },
  {
    timestamps: true,
  }
);

const SystemConfig = mongoose.model<ISystemConfig>('SystemConfig', SystemConfigSchema);

export default SystemConfig;
