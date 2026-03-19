import mongoose, { Document, Schema } from 'mongoose';
import { PlanType } from '../config/plans';

export interface INotification extends Document {
  title: string;
  message: string;
  type: 'info' | 'warning' | 'critical';
  targetPlans: PlanType[];
  sendEmail: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
    },
    targetPlans: {
      type: [String],
      required: true,
    },
    sendEmail: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Notification = mongoose.model<INotification>('Notification', NotificationSchema);

export default Notification;
