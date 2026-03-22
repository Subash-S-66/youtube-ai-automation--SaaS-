import mongoose, { Document, Schema } from 'mongoose';

export interface IPayment extends Document {
  userId: mongoose.Types.ObjectId;
  planId: string; // The name of the plan purchased e.g., 'pro'
  amount: number;
  currency: string;
  status: 'success' | 'failed' | 'pending';
  provider: string; // e.g., 'razorpay'
  transactionId: string;
  receiptUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'USD' },
    status: { type: String, enum: ['success', 'failed', 'pending'], required: true },
    provider: { type: String, required: true },
    transactionId: { type: String, required: true, unique: true },
    receiptUrl: { type: String },
  },
  {
    timestamps: true,
  }
);

const Payment = mongoose.model<IPayment>('Payment', PaymentSchema);

export default Payment;
