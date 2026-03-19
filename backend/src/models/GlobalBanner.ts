import mongoose, { Document, Schema } from 'mongoose';

export interface IGlobalBanner extends Document {
  message: string;
  isActive: boolean;
  type: 'info' | 'warning' | 'critical';
  updatedAt: Date;
}

const GlobalBannerSchema = new Schema<IGlobalBanner>(
  {
    message: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
    },
  },
  {
    timestamps: true,
  }
);

const GlobalBanner = mongoose.model<IGlobalBanner>('GlobalBanner', GlobalBannerSchema);

export default GlobalBanner;
