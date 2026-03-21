import mongoose, { Document, Schema } from 'mongoose';

export interface ISchedule extends Document {
  userId: mongoose.Types.ObjectId;
  channelId: string;
  type: 'one-time' | 'recurring';
  datetime?: Date;
  cron_expression?: string;
  videoConfig: any;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

const ScheduleSchema = new Schema<ISchedule>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channelId: { type: String, required: true },
    type: { type: String, enum: ['one-time', 'recurring'], required: true },
    datetime: { type: Date },
    cron_expression: { type: String },
    videoConfig: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'cancelled'], default: 'pending' },
  },
  {
    timestamps: true,
  }
);

const Schedule = mongoose.model<ISchedule>('Schedule', ScheduleSchema);

export default Schedule;
