import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import JobModel from '../models/Job';

// @desc    Receive job status updates from Python pipeline
// @route   POST /api/webhook/job-status
// @access  Public (should verify secret in production)
export const handleJobStatusWebhook = asyncHandler(async (req: Request, res: Response) => {
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
