import mongoose, { Document, Schema } from 'mongoose';

export interface IGlobalBanner extends Document {
  message: string;
  isActive: boolean;
  createdAt: Date;
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
  },
  {
    timestamps: true,
  }
);

const GlobalBanner = mongoose.model<IGlobalBanner>('GlobalBanner', GlobalBannerSchema);

export default GlobalBanner;
