import mongoose, { Document, Schema } from 'mongoose';

export interface IPrompt extends Document {
  userId: mongoose.Types.ObjectId;
  user_prompt: string;
  gemini_prompt: string;
  createdAt: Date;
  updatedAt: Date;
}

const PromptSchema = new Schema<IPrompt>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    user_prompt: {
      type: String,
      required: true,
      trim: true,
    },
    gemini_prompt: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Prompt = mongoose.model<IPrompt>('Prompt', PromptSchema);

export default Prompt;
