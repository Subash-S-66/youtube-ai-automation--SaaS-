import mongoose, { Document, Schema } from 'mongoose';

export interface IDeletedUser extends Document {
  email: string;
  planHistory: any[];
  usageStats: {
    uploadsUsedTotal: number;
    // can add more stats here
  };
  deletedAt: Date;
}

const DeletedUserSchema = new Schema<IDeletedUser>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    planHistory: {
      type: [String],
      default: [],
    },
    usageStats: {
      type: Schema.Types.Mixed,
      default: {},
    },
    deletedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false, // We use deletedAt explicitly
  }
);

const DeletedUser = mongoose.model<IDeletedUser>('DeletedUser', DeletedUserSchema);

export default DeletedUser;
