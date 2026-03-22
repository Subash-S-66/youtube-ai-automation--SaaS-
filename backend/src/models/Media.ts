import mongoose, { Document, Schema } from 'mongoose';

export interface IMedia extends Document {
  userId: mongoose.Types.ObjectId;
  type: 'video' | 'image' | 'thumbnail';
  filename: string;
  originalName: string;
  size: number;
  duration?: number; // Only applicable for videos
  path: string;
  createdAt: Date;
  updatedAt: Date;
}

const MediaSchema = new Schema<IMedia>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['video', 'image', 'thumbnail'], required: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    size: { type: Number, required: true },
    duration: { type: Number },
    path: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

const Media = mongoose.model<IMedia>('Media', MediaSchema);

export default Media;
