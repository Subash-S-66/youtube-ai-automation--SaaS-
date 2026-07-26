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
  order: number;
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
      default: true,
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
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const GlobalBanner = mongoose.model<IGlobalBanner>('GlobalBanner', GlobalBannerSchema);

export default GlobalBanner;
