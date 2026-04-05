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
    template_customization: boolean;
    custom_media: boolean;
  };
  limits: {
    max_channels: number;
    daily_upload_limit: number;
    max_media_items: number;
    max_video_items: number;
    max_image_items: number;
    max_thumbnail_items: number;
    max_clip_length_seconds: number;
    max_total_video_duration_seconds: number;
  };
  discountPercentage: number;
  featuresList: string[];
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema = new Schema<IPlan>(
  {
    name: { type: String, required: true, unique: true },
    price: { type: Number, required: true, default: 0 },
    discountPercentage: { type: Number, default: 0 },
    priority_weight: { type: Number, required: true, default: 0 },
    is_active: { type: Boolean, required: true, default: true },
    featuresList: { type: [String], default: [] },
    features: {
      voice_selection: { type: Boolean, default: false },
      scheduling: { type: Boolean, default: false },
      multi_channel: { type: Boolean, default: false },
      story_mode: { type: Boolean, default: false },
      cta: { type: Boolean, default: false },
      format_selection: { type: Boolean, default: false },
      template_customization: { type: Boolean, default: false },
      custom_media: { type: Boolean, default: false },
    },
    limits: {
      max_channels: { type: Number, default: 1 },
      daily_upload_limit: { type: Number, default: 1 },
      max_media_items: { type: Number, default: 0 },
      max_video_items: { type: Number, default: 0 },
      max_image_items: { type: Number, default: 0 },
      max_thumbnail_items: { type: Number, default: 0 },
      max_clip_length_seconds: { type: Number, default: 0 },
      max_total_video_duration_seconds: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

const Plan = mongoose.model<IPlan>('Plan', PlanSchema);

export default Plan;
