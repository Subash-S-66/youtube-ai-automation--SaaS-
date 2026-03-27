import mongoose, { Document, Schema } from 'mongoose';

export interface ISystemConfig extends Document {
  betaMode: boolean;
  pipelineRunner?: 'github' | 'azure';
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
    pipelineRunner: {
      type: String,
      enum: ['github', 'azure'],
      default: 'github',
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
