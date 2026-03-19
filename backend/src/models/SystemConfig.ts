import mongoose, { Document, Schema } from 'mongoose';

export interface ISystemConfig extends Document {
  betaMode: boolean;
  updatedAt: Date;
}

const SystemConfigSchema = new Schema<ISystemConfig>(
  {
    betaMode: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const SystemConfig = mongoose.model<ISystemConfig>('SystemConfig', SystemConfigSchema);

export default SystemConfig;
