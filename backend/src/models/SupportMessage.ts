import mongoose, { Document, Schema } from 'mongoose';

export interface ISupportMessage extends Document {
  ticketId: mongoose.Types.ObjectId;
  sender: 'user' | 'admin';
  message: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SupportMessageSchema = new Schema<ISupportMessage>(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
      index: true,
    },
    sender: {
      type: String,
      enum: ['user', 'admin'],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index to quickly fetch messages for a specific ticket, sorted by time
SupportMessageSchema.index({ ticketId: 1, createdAt: 1 });

const SupportMessage = mongoose.model<ISupportMessage>('SupportMessage', SupportMessageSchema);

export default SupportMessage;
