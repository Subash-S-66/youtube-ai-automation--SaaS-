import mongoose, { Document, Schema } from 'mongoose';

export interface ISupportTicket extends Document {
  userId: mongoose.Types.ObjectId;
  status: 'open' | 'closed';
  closedAt?: Date;
  expireAt?: Date; // For 24h UI disappearance
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
    expireAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for finding a user's active/recent tickets efficiently
SupportTicketSchema.index({ userId: 1, status: 1 });

const SupportTicket = mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);

export default SupportTicket;
