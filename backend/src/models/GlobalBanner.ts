import mongoose, { Document, Schema } from 'mongoose';

export interface IGlobalBanner extends Document {
  message: string;
  isActive: boolean;
  type:
    | 'info-blue'
    | 'info-cyan'
    | 'info-green'
    | 'info-purple'
    | 'warning-amber'
    | 'warning-gold'
    | 'critical-red'
    | 'critical-rose';
  startAt?: Date;
  endAt?: Date;
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
      enum: [
        'info-blue',
        'info-cyan',
        'info-green',
        'info-purple',
        'warning-amber',
        'warning-gold',
        'critical-red',
        'critical-rose',
      ],
      default: 'info-blue',
    },
    startAt: {
      type: Date,
    },
    endAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const GlobalBanner = mongoose.model<IGlobalBanner>('GlobalBanner', GlobalBannerSchema);

export default GlobalBanner;
