import mongoose, { Document, Schema } from 'mongoose';

export interface IPlan extends Document {
  name: string; // e.g., 'free', 'basic', 'pro', 'premium'
  price: number;
  priority_weight: number;
  is_active: boolean;
  features: {
    voice_selection: boolean;
    scheduling: boolean;
    multi_channel: boolean;
    story_mode: boolean;
    cta: boolean;
    format_selection: boolean;
  };
  limits: {
    max_channels: number;
    daily_upload_limit: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema = new Schema<IPlan>(
  {
    name: { type: String, required: true, unique: true },
    price: { type: Number, required: true, default: 0 },
    priority_weight: { type: Number, required: true, default: 0 },
    is_active: { type: Boolean, required: true, default: true },
    features: {
      voice_selection: { type: Boolean, default: false },
      scheduling: { type: Boolean, default: false },
      multi_channel: { type: Boolean, default: false },
      story_mode: { type: Boolean, default: false },
      cta: { type: Boolean, default: false },
      format_selection: { type: Boolean, default: false },
    },
    limits: {
      max_channels: { type: Number, default: 1 },
      daily_upload_limit: { type: Number, default: 1 },
    },
  },
  {
    timestamps: true,
  }
);

const Plan = mongoose.model<IPlan>('Plan', PlanSchema);

export default Plan;
