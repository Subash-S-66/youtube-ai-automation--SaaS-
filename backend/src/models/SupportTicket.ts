import mongoose, { Document, Schema } from 'mongoose';

export interface ISupportTicket extends Document {
  userId: mongoose.Types.ObjectId;
  status: 'open' | 'closed';
  closedAt?: Date;
  closedBy?: mongoose.Types.ObjectId;
  helperClosed?: boolean;
  userClosed?: boolean;
  userHidden?: boolean;
  feedbackRating?: number;
  feedbackComment?: string;
  feedbackPending?: boolean;
  unreadUserCount?: number;
  unreadHelperCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
      index: true,
    },
    closedAt: {
      type: Date,
    },
    closedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    helperClosed: {
      type: Boolean,
      default: false,
    },
    userClosed: {
      type: Boolean,
      default: false,
    },
    userHidden: {
      type: Boolean,
      default: false,
    },
    feedbackRating: {
      type: Number,
      min: 1,
      max: 5,
    },
    feedbackComment: {
      type: String,
      trim: true,
    },
    feedbackPending: {
      type: Boolean,
      default: false,
    },
    unreadUserCount: {
      type: Number,
      default: 0,
    },
    unreadHelperCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

SupportTicketSchema.index({ userId: 1, status: 1 });

const SupportTicket = mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);

export default SupportTicket;
