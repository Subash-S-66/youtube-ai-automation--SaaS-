import mongoose, { Document, Schema } from 'mongoose';

export type ScheduleType = 'one-time' | 'interval';

export interface ISchedule extends Document {
  userId: mongoose.Types.ObjectId;
  channelId: string;
  type: ScheduleType;
  enabled: boolean;
  running: boolean;
  datetime?: Date;
  intervalHours?: number;
  videosPerInterval?: number;
  nextRunAt: Date;
  lastRunAt?: Date;
  lastJobId?: mongoose.Types.ObjectId;
  lastError?: string;
  videoConfig: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduleSchema = new Schema<ISchedule>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    channelId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['one-time', 'interval'],
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    running: {
      type: Boolean,
      default: false,
    },
    datetime: {
      type: Date,
    },
    intervalHours: {
      type: Number,
    },
    videosPerInterval: {
      type: Number,
    },
    nextRunAt: {
      type: Date,
      required: true,
    },
    lastRunAt: {
      type: Date,
    },
    lastJobId: {
      type: Schema.Types.ObjectId,
      ref: 'Job',
    },
    lastError: {
      type: String,
    },
    videoConfig: {
      type: Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

ScheduleSchema.index({ userId: 1, channelId: 1, enabled: 1, nextRunAt: 1 });

const Schedule = mongoose.model<ISchedule>('Schedule', ScheduleSchema);

export default Schedule;
