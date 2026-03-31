import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import JobModel from '../models/Job';
import User from '../models/User';
import crypto from 'crypto';

const appendRecentTopic = async (userId: string, topic: string): Promise<void> => {
  const chosenTopic = String(topic || '').trim(); // FIXED: Normalize chosen topic before storing in history.
  if (!chosenTopic) return;
  const user = await User.findById(userId);
  if (!user) return;
  const previousTopics = Array.isArray((user as any).recentTopics)
    ? (user as any).recentTopics.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : [];
  previousTopics.push(chosenTopic); // FIXED: Persist successful sub-topic for future anti-repeat generation.
  (user as any).recentTopics = previousTopics.slice(-100); // FIXED: Keep only the latest 100 stored topics.
  user.markModified('recentTopics');
  await user.save();
};

const verifyWebhookSecret = (req: Request, res: Response): boolean => {
  const secret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    res.status(500).json({ error: 'WEBHOOK_SECRET environment variable is not configured' });
    return false;
  }

  if (!secret || typeof secret !== 'string') {
    res.status(401).json({ error: 'Missing x-webhook-secret header' });
    return false;
  }

  const secretBuffer = Buffer.from(secret);
  const expectedBuffer = Buffer.from(expectedSecret);
  if (
    secretBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(secretBuffer, expectedBuffer)
  ) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return false;
  }
  return true;
};

// @desc    Receive job status updates from Python pipeline
// @route   POST /api/webhook/job-status
// @access  Private (verified via x-webhook-secret)
export const handleJobStatusWebhook = asyncHandler(async (req: Request, res: Response) => {
  console.log(`[Webhook] Received webhook payload:`, req.body);
  if (!verifyWebhookSecret(req, res)) {
    return;
  }

  const { jobId, status, logs, videoUrl, youtubeVideoId, errorMessage, errorStage, processedVideos, userId: webhookUserId } = req.body;

  if (typeof jobId !== 'string' || !jobId.trim() || typeof status !== 'string' || !status.trim()) {
    res.status(400).json({ error: 'Missing jobId or status' });
    return;
  }

  // Idempotency check for webhook processing using Redis
  const { connection } = await import('../config/redis.js');
  if (connection) {
    // Generate a unique idempotency key based on job ID and the status payload (so we don't block legitimate status updates like pending -> processing -> success)
    const idempotencyKey = `webhook:idempotency:${jobId}:${status}`;
    const setNxResult = await connection.set(idempotencyKey, 'processing', 'EX', 60 * 60, 'NX'); // 1 hour TTL
    if (!setNxResult) {
      console.log(`[Webhook] Duplicate status update received for job ${jobId} (status: ${status}). Ignoring.`);
      res.status(200).json({ success: true, duplicate: true });
      return;
    }
  }

  const job = await JobModel.findById(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const resolvedUserId = String(webhookUserId || '').trim(); // FIXED: Resolve caller-provided userId for ownership verification.
  if (!resolvedUserId) {
    res.status(400).json({ error: 'Missing userId in webhook payload' }); // FIXED: Require userId to prevent blind status mutation by jobId alone.
    return;
  }
  if (job.userId.toString() !== resolvedUserId) {
    res.status(403).json({ error: 'Job does not belong to this user' }); // FIXED: Enforce strict job-to-user ownership check.
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
  if (typeof processedVideos === 'number' && processedVideos >= 0) {
    job.processedVideos = processedVideos;
  }

  // Update status if it's changing
  const { consumeReservedCredits, releaseReservedCredits } = await import('../services/uploadLimitService.js');
  const uploadDisabled = (job as any)?.pipelineConfig?.upload === false;
  const requiresUpload = !uploadDisabled && Boolean(
    (job as any)?.pipelineConfig?.upload === true ||
    (job as any)?.pipelineConfig?.autoUpload === true ||
    (job as any)?.pipelineConfig?.autoUploadSchedule === true ||
    (job as any)?.pipelineConfig?.scheduleEnabled === true ||
    (job as any)?.pipelineConfig?.publishNow === true ||
    (typeof (job as any)?.pipelineConfig?.channelId === 'string' && (job as any).pipelineConfig.channelId.trim().length > 0)
  );
  const acceptedWarning = Boolean((job as any)?.acceptedYouTubeLimitWarning);
  const requestedCount = Math.max(1, Number(job.videoCount || 1));
  const processedCountRaw = typeof processedVideos === 'number' && processedVideos > 0
    ? processedVideos
    : (typeof job.processedVideos === 'number' && job.processedVideos > 0 ? job.processedVideos : requestedCount);
  const processedCount = Math.min(requestedCount, Math.max(1, Math.floor(processedCountRaw)));
  const remainingCount = Math.max(0, requestedCount - processedCount);

  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === 'success' || normalizedStatus === 'completed') {
     const resolvedVideoUrl = (
       (typeof videoUrl === 'string' && videoUrl.trim()) ||
       (typeof job.videoUrl === 'string' && job.videoUrl.trim()) ||
       ''
     ) as string;
     const resolvedYoutubeVideoId = (
       (typeof youtubeVideoId === 'string' && youtubeVideoId.trim()) ||
       (typeof job.youtubeVideoId === 'string' && job.youtubeVideoId.trim()) ||
       ''
     ) as string;
     const uploadConfirmed = !requiresUpload || Boolean(
       resolvedYoutubeVideoId ||
       (resolvedVideoUrl && /^https?:\/\//i.test(resolvedVideoUrl))
     );

     if (!uploadConfirmed) {
       const updatedJob = await JobModel.findOneAndUpdate(
         { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
         {
           $set: {
             status: 'failed',
             completedAt: new Date(),
             holdConsumed: acceptedWarning,
             holdReleased: !acceptedWarning,
             error: 'Upload failed or was skipped.',
             errorMessage: 'Upload failed or was skipped.',
             errorStage: 'UPLOAD' as any,
             result: {
               success: false,
               videoUrl: resolvedVideoUrl || '',
               youtubeVideoId: resolvedYoutubeVideoId || '',
             }
           }
         },
         { new: true }
       );
       if (updatedJob) {
         if (acceptedWarning) {
           await consumeReservedCredits(job.userId.toString(), processedCount || requestedCount).catch(console.error);
         } else {
           await releaseReservedCredits(job.userId.toString(), requestedCount).catch(console.error);
         }
       }
       await job.save();
       res.status(200).json({ success: true });
       return;
     }

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
       await consumeReservedCredits(job.userId.toString(), processedCount || requestedCount).catch(console.error);
       if (remainingCount > 0) {
         await releaseReservedCredits(job.userId.toString(), remainingCount).catch(console.error);
       }
       await appendRecentTopic(updatedJob.userId.toString(), String((updatedJob as any).chosenSubTopic || '')).catch(console.error); // FIXED: Update user recent topics after webhook-confirmed success.
     } else {
       console.log(`[Webhook] Job ${jobId} already processed (success). Skipping duplicate update.`);
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
           holdConsumed: acceptedWarning && parsedErrorStage === 'UPLOAD',
           holdReleased: !(acceptedWarning && parsedErrorStage === 'UPLOAD'),
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
       if (acceptedWarning && parsedErrorStage === 'UPLOAD') {
         await consumeReservedCredits(job.userId.toString(), processedCount || requestedCount).catch(console.error);
       } else {
         await releaseReservedCredits(job.userId.toString(), requestedCount).catch(console.error);
       }
     } else {
       console.log(`[Webhook] Job ${jobId} already processed (failed). Skipping duplicate update.`);
     }
  } else if (normalizedStatus === 'youtube_rejected') {
     const resolvedError = (typeof errorMessage === 'string' && errorMessage.trim()) ? errorMessage.trim() : 'YouTube limits rejected the upload';

     const updatedJob = await JobModel.findOneAndUpdate(
       { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
       {
         $set: {
           status: 'failed',
           completedAt: new Date(),
           holdConsumed: acceptedWarning,
           holdReleased: !acceptedWarning,
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
       if (acceptedWarning) {
         await consumeReservedCredits(job.userId.toString(), processedCount || requestedCount).catch(console.error);
       } else {
         await releaseReservedCredits(job.userId.toString(), requestedCount).catch(console.error);
       }
     } else {
       console.log(`[Webhook] Job ${jobId} already processed (youtube_rejected). Skipping duplicate update.`);
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

// @desc    Receive final pipeline-complete payload and persist on backend
// @route   POST /api/webhook/pipeline-complete
// @access  Private (verified via x-webhook-secret)
export const handlePipelineCompleteWebhook = asyncHandler(async (req: Request, res: Response) => {
  console.log(`[Webhook] Received pipeline-complete payload:`, req.body);
  if (!verifyWebhookSecret(req, res)) {
    return;
  }

  const payload = req.body || {};
  const jobId = String(payload.jobId || '').trim();
  if (!jobId) {
    res.status(400).json({ error: 'Missing jobId' });
    return;
  }

  const resultPayload = payload.result ?? payload;
  const normalizedStatus = String(payload.status || payload.state || '').toLowerCase();
  const resultStatus = String(resultPayload?.status || resultPayload?.state || '').toLowerCase();
  const statusHint = normalizedStatus || resultStatus;

  const resolvedVideoUrl = String(
    resultPayload?.videoUrl ||
    resultPayload?.result?.videoUrl ||
    resultPayload?.youtube?.videoUrl ||
    ''
  ).trim();
  const resolvedYoutubeVideoId = String(
    resultPayload?.youtubeVideoId ||
    resultPayload?.result?.youtubeVideoId ||
    resultPayload?.youtube?.youtubeVideoId ||
    ''
  ).trim();

  const { connection } = await import('../config/redis.js');
  if (connection) {
    const signatureHash = crypto
      .createHash('sha1')
      .update(
        JSON.stringify({
          statusHint,
          resolvedVideoUrl,
          resolvedYoutubeVideoId,
          errorMessage: String(resultPayload?.errorMessage || payload?.errorMessage || '').trim(),
        })
      )
      .digest('hex')
      .slice(0, 16);
    const idempotencyKey = `webhook:pipeline-complete:${jobId}:${signatureHash}`;
    const setNxResult = await connection.set(idempotencyKey, 'processing', 'EX', 60 * 60, 'NX');
    if (!setNxResult) {
      res.status(200).json({ success: true, duplicate: true });
      return;
    }
  }

  const job = await JobModel.findById(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const uploadRequested = typeof resultPayload?.uploadRequested === 'boolean'
    ? resultPayload.uploadRequested
    : (job.pipelineConfig?.upload !== false);
  const uploadSkipped = Boolean(resultPayload?.uploadSkipped);
  const uploadConfirmed = !uploadRequested || uploadSkipped || Boolean(
    resolvedYoutubeVideoId ||
    (resolvedVideoUrl && /^https?:\/\//i.test(resolvedVideoUrl))
  );

  const acceptedWarning = Boolean((job as any)?.acceptedYouTubeLimitWarning);
  const requestedCount = Math.max(1, Number(job.videoCount || 1));
  const warningList = Array.isArray(resultPayload?.metadata?.warnings)
    ? resultPayload.metadata.warnings.map((warning: unknown) => String(warning || '').toLowerCase())
    : [];
  const uploadWarning = warningList.find((warning: string) => warning.includes('upload_error'));

  let nextStatus: 'success' | 'failed' | 'processing' = 'processing';
  if (statusHint && ['failed', 'error', 'errored'].includes(statusHint)) {
    nextStatus = 'failed';
  } else if (uploadWarning && uploadRequested && !uploadConfirmed) {
    nextStatus = 'failed';
  } else if (!uploadRequested || uploadSkipped || uploadConfirmed) {
    nextStatus = 'success';
  }

  const failureMessage = nextStatus === 'failed'
    ? (String(resultPayload?.errorMessage || payload?.errorMessage || '').trim() ||
        (uploadWarning ? String(uploadWarning).replace(/^upload_error:/, '').trim() : '') ||
        (uploadConfirmed ? 'Pipeline failed' : 'Upload failed or was skipped.'))
    : '';
  const failureStage = nextStatus === 'failed'
    ? (uploadConfirmed
        ? (typeof resultPayload?.errorStage === 'string' ? resultPayload.errorStage : undefined)
        : 'UPLOAD')
    : undefined;

  const updatePayload: Record<string, any> = {
    result: resultPayload,
    progress: {
      progress: nextStatus === 'processing' ? 95 : 100,
      stage: nextStatus === 'success' ? 'completed' : (nextStatus === 'failed' ? 'failed' : 'upload_confirmation_pending'),
      message: nextStatus === 'success'
        ? 'Job completed successfully'
        : (nextStatus === 'failed' ? 'Job failed' : 'Waiting for final upload confirmation'),
      timestamp: new Date().toISOString(),
    },
  };
  if (resolvedVideoUrl) updatePayload.videoUrl = resolvedVideoUrl;
  if (resolvedYoutubeVideoId) updatePayload.youtubeVideoId = resolvedYoutubeVideoId;

  if (nextStatus === 'processing') {
    await JobModel.updateOne(
      { _id: jobId, status: { $in: ['pending', 'processing'] } },
      {
        $set: {
          ...updatePayload,
          status: 'processing',
        },
        $unset: {
          completedAt: '',
          error: '',
          errorMessage: '',
          errorStage: '',
        },
      }
    );
    res.status(200).json({ success: true, deferred: true });
    return;
  }

  const finalized = await JobModel.findOneAndUpdate(
    { _id: jobId, status: { $in: ['pending', 'processing'] }, holdConsumed: false, holdReleased: false },
    {
      $set: {
        ...updatePayload,
        status: nextStatus,
        completedAt: new Date(),
        holdConsumed: nextStatus === 'success' || (acceptedWarning && nextStatus === 'failed' && uploadRequested),
        holdReleased: nextStatus === 'failed' && !(acceptedWarning && uploadRequested),
        error: nextStatus === 'failed' ? failureMessage : undefined,
        errorMessage: nextStatus === 'failed' ? failureMessage : '',
        errorStage: nextStatus === 'failed' ? failureStage : undefined,
      },
    },
    { new: true }
  );

  if (finalized) {
    const { consumeReservedCredits, releaseReservedCredits } = await import('../services/uploadLimitService.js');
    if (nextStatus === 'success') {
      await consumeReservedCredits(job.userId.toString(), requestedCount).catch(console.error);
      await appendRecentTopic(finalized.userId.toString(), String((finalized as any).chosenSubTopic || '')).catch(console.error);
    } else if (acceptedWarning && uploadRequested) {
      await consumeReservedCredits(job.userId.toString(), requestedCount).catch(console.error);
    } else {
      await releaseReservedCredits(job.userId.toString(), requestedCount).catch(console.error);
    }
    res.status(200).json({ success: true });
    return;
  }

  await JobModel.updateOne(
    { _id: jobId },
    { $set: updatePayload }
  );

  res.status(200).json({ success: true });
});
