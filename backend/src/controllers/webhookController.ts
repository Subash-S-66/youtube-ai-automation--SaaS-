import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import JobModel from '../models/Job';
import crypto from 'crypto';

// @desc    Receive job status updates from Python pipeline
// @route   POST /api/webhook/job-status
// @access  Private (verified via x-webhook-secret)
export const handleJobStatusWebhook = asyncHandler(async (req: Request, res: Response) => {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('WEBHOOK_SECRET is not configured on the server');
  }

  const providedSecret = req.headers['x-webhook-secret'];
  if (!providedSecret || typeof providedSecret !== 'string') {
    res.status(401).json({ error: 'Missing webhook secret' });
    return;
  }

  const expectedBuffer = Buffer.from(webhookSecret);
  const providedBuffer = Buffer.from(providedSecret);

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }

  const { jobId, status, logs } = req.body;

  if (!jobId || !status) {
    res.status(400).json({ error: 'Missing jobId or status' });
    return;
  }

  const job = await JobModel.findById(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Append new logs if provided
  if (logs) {
    job.logs = (job.logs || '') + '\n' + logs;
  }

  // Update status if it's changing
  if (status !== job.status) {
    job.status = status;
    // Emitting via Socket.IO would go here if socket server was available globally
    // e.g. req.app.get('io').to(job.userId.toString()).emit('jobStatusUpdate', { jobId, status });
  }

  await job.save();

  res.status(200).json({ success: true });
});
