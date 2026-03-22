import mongoose, { Document, Schema } from 'mongoose';

export interface ISystemConfig extends Document {
  betaMode: boolean;
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
  updatedAt: Date;
}

const SystemConfigSchema = new Schema<ISystemConfig>(
  {
    betaMode: {
      type: Boolean,
      default: false,
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
  },
  {
    timestamps: true,
  }
);

const SystemConfig = mongoose.model<ISystemConfig>('SystemConfig', SystemConfigSchema);

export default SystemConfig;
