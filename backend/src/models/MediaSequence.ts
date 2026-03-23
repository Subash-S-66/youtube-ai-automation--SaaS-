import mongoose, { Document, Schema } from 'mongoose';

export interface IMediaSequence extends Document {
  userId: mongoose.Types.ObjectId;
  mediaId: mongoose.Types.ObjectId;
  type: 'video' | 'image';
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const MediaSequenceSchema = new Schema<IMediaSequence>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media', required: true },
    type: { type: String, enum: ['video', 'image'], required: true },
    sortOrder: { type: Number, default: Date.now },
  },
  {
    timestamps: true,
  }
);

const MediaSequence = mongoose.model<IMediaSequence>('MediaSequence', MediaSequenceSchema);

export default MediaSequence;
