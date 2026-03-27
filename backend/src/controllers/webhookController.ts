import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import JobModel from '../models/Job';
import crypto from 'crypto';

// @desc    Receive job status updates from Python pipeline
// @route   POST /api/webhook/job-status
// @access  Private (verified via x-webhook-secret)
export const handleJobStatusWebhook = asyncHandler(async (req: Request, res: Response) => {
  console.log(`[Webhook] Received webhook payload:`, req.body);
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

  const { jobId, status, logs, videoUrl, youtubeVideoId, errorMessage, errorStage } = req.body;

  if (typeof jobId !== 'string' || !jobId.trim() || typeof status !== 'string' || !status.trim()) {
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
  if (typeof videoUrl === 'string' && videoUrl.trim()) {
    job.videoUrl = videoUrl.trim();
  }
  if (typeof youtubeVideoId === 'string' && youtubeVideoId.trim()) {
    job.youtubeVideoId = youtubeVideoId.trim();
  }

  // Update status if it's changing
  const { consumeReservedCredits, releaseReservedCredits } = await import('../services/uploadLimitService.js');

  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === 'success' || normalizedStatus === 'completed') {
     const updatedJob = await JobModel.findOneAndUpdate(
       { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
       {
         $set: {
           status: 'success',
           completedAt: new Date(),
           holdConsumed: true,
           errorMessage: '',
           errorStage: undefined as any,
           result: {
             success: true,
             videoUrl: job.videoUrl || '',
             youtubeVideoId: job.youtubeVideoId || '',
           }
         }
       },
       { new: true }
     );
     if (updatedJob) {
       await consumeReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
     } else {
       // Just update fields if already consumed/released
       job.status = 'success';
       job.completedAt = new Date();
       job.errorMessage = '';
       job.errorStage = undefined as any;
       job.result = {
         success: true,
         videoUrl: job.videoUrl || '',
         youtubeVideoId: job.youtubeVideoId || '',
       };
     }
  } else if (normalizedStatus === 'failed') {
     const resolvedError = (typeof errorMessage === 'string' && errorMessage.trim()) ? errorMessage.trim() : (logs || 'Failed via webhook');
     const parsedErrorStage = (typeof errorStage === 'string' && ['TOKEN', 'CONTENT_GENERATION', 'RENDER', 'UPLOAD'].includes(errorStage)) ? errorStage as any : undefined;

     const updatedJob = await JobModel.findOneAndUpdate(
       { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
       {
         $set: {
           status: 'failed',
           completedAt: new Date(),
           holdReleased: true,
           error: resolvedError,
           errorMessage: resolvedError,
           errorStage: parsedErrorStage,
           result: {
             success: false,
             videoUrl: job.videoUrl || '',
             youtubeVideoId: job.youtubeVideoId || '',
           }
         }
       },
       { new: true }
     );
     if (updatedJob) {
       await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
     } else {
       job.status = 'failed';
       job.completedAt = new Date();
       job.error = resolvedError;
       job.errorMessage = resolvedError;
       if (parsedErrorStage) job.errorStage = parsedErrorStage;
       job.result = {
         success: false,
         videoUrl: job.videoUrl || '',
         youtubeVideoId: job.youtubeVideoId || '',
       };
     }
  } else if (normalizedStatus === 'youtube_rejected') {
     const resolvedError = (typeof errorMessage === 'string' && errorMessage.trim()) ? errorMessage.trim() : 'YouTube limits rejected the upload';

     const updatedJob = await JobModel.findOneAndUpdate(
       { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
       {
         $set: {
           status: 'failed',
           completedAt: new Date(),
           holdReleased: true,
           error: resolvedError,
           errorMessage: resolvedError,
           errorStage: 'UPLOAD' as any,
           result: {
             success: false,
             videoUrl: job.videoUrl || '',
             youtubeVideoId: job.youtubeVideoId || '',
           }
         }
       },
       { new: true }
     );
     if (updatedJob) {
       await releaseReservedCredits(job.userId.toString(), job.videoCount || 1).catch(console.error);
     } else {
       job.status = 'failed';
       job.completedAt = new Date();
       job.error = resolvedError;
       job.errorMessage = resolvedError;
       job.errorStage = 'UPLOAD' as any;
       job.result = {
         success: false,
         videoUrl: job.videoUrl || '',
         youtubeVideoId: job.youtubeVideoId || '',
       };
     }
  } else if (normalizedStatus === 'processing') {
     job.status = 'processing';
  } else if (normalizedStatus === 'pending') {
     job.status = 'pending';
  } else {
     res.status(400).json({ error: `Unsupported status '${status}'` });
     return;
  }

  await job.save();

  res.status(200).json({ success: true });
});
