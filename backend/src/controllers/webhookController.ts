import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import JobModel from '../models/Job';
import crypto from 'crypto';

// @desc    Receive job status updates from Python pipeline
// @route   POST /api/webhook/job-status
// @access  Private (verified via x-webhook-secret)
export const handleJobStatusWebhook = asyncHandler(async (req: Request, res: Response) => {
  const secret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    res.status(500).json({ error: 'WEBHOOK_SECRET environment variable is not configured' });
    return;
  }

  if (!secret || typeof secret !== 'string') {
    res.status(401).json({ error: 'Missing x-webhook-secret header' });
    return;
  }

  const secretBuffer = Buffer.from(secret);
  const expectedBuffer = Buffer.from(expectedSecret);

  if (
    secretBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(secretBuffer, expectedBuffer)
  ) {
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

  // Prevent double-handling
  if (job.holdConsumed || job.holdReleased) {
     res.status(200).json({ success: true, message: 'Already handled' });
     return;
  }

  // Append new logs if provided
  if (logs) {
    job.logs = (job.logs || '') + '\n' + logs;
  }

  // Update status if it's changing
  const { consumeReservedCredits, releaseReservedCredits } = await import('../services/uploadLimitService.js');

  if (status === 'success' || status === 'completed') {
     job.status = 'completed';
     job.completedAt = new Date();
     job.holdConsumed = true;
     await consumeReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
  } else if (status === 'failed') {
     job.status = 'failed';
     job.completedAt = new Date();
     job.holdReleased = true;
     job.error = logs || 'Failed via webhook';
     await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
  } else if (status && status !== job.status) {
     // queued, processing, running
     job.status = status;
  }

  await job.save();

  res.status(200).json({ success: true });
});
