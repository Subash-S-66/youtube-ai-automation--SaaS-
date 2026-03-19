import mongoose, { Document, Schema } from 'mongoose';

export interface IStoryProgress extends Document {
  userId: mongoose.Types.ObjectId;
  storyId: string;
  currentPart: number;
  lastPrompt: string;
  createdAt: Date;
  updatedAt: Date;
}

const StoryProgressSchema = new Schema<IStoryProgress>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    storyId: {
      type: String,
      required: true,
      index: true,
    },
    currentPart: {
      type: Number,
      required: true,
      default: 1,
    },
    lastPrompt: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure a user only has one progress entry per storyId
StoryProgressSchema.index({ userId: 1, storyId: 1 }, { unique: true });

const StoryProgress = mongoose.model<IStoryProgress>('StoryProgress', StoryProgressSchema);

export default StoryProgress;
