import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import JobModel from '../models/Job';
import User from '../models/User';
import crypto from 'crypto';
import { applyUserJobHistoryRetention } from '../services/jobHistoryRetentionPolicyService';
import { decrementChannelVideosOnHold, resolveJobChannelId } from '../services/channelHoldService';

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

const isYouTubeLimitFailure = (message: string): boolean => {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('quotaexceeded') ||
    normalized.includes('dailylimitexceeded') ||
    normalized.includes('uploadlimitexceeded') ||
    normalized.includes('too many uploads') ||
    (normalized.includes('youtube') && normalized.includes('limit')) ||
    (normalized.includes('quota') && normalized.includes('upload'))
  );
};

const clampSuccessfulUploads = (requestedCount: number, raw: unknown): number | undefined => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Math.min(requestedCount, Math.floor(parsed)));
};

const resolveSettlementCounts = (params: {
  requestedCount: number;
  successfulUploads?: number;
  uploadFailure: boolean;
  acceptedYouTubeLimitWarning: boolean;
}): { consumeCount: number; releaseCount: number } => {
  const requestedCount = Math.max(1, Math.floor(Number(params.requestedCount || 1)));
  const successfulUploads = Math.max(0, Math.min(requestedCount, Math.floor(Number(params.successfulUploads || 0))));

  const consumeCount = params.uploadFailure
    ? (params.acceptedYouTubeLimitWarning ? requestedCount : successfulUploads)
    : successfulUploads;

  return {
    consumeCount,
    releaseCount: Math.max(0, requestedCount - consumeCount),
  };
};

const settleGlobalAndChannelHolds = async (params: {
  userId: string;
  requestedCount: number;
  consumeCount: number;
  releaseCount: number;
  jobRecord: Record<string, any> | null | undefined;
  source: string;
}): Promise<void> => {
  const userId = String(params.userId || '').trim();
  if (!userId) {
    return;
  }

  const requestedCount = Math.max(1, Math.floor(Number(params.requestedCount || 1)));
  const consumeCount = Math.max(0, Math.min(requestedCount, Math.floor(Number(params.consumeCount || 0))));
  const releaseCount = Math.max(0, Math.min(requestedCount, Math.floor(Number(params.releaseCount || 0))));

  const { consumeReservedCredits, releaseReservedCredits, reconcileUserHoldCounters } = await import('../services/uploadLimitService.js');

  if (consumeCount > 0) {
    await consumeReservedCredits(userId, consumeCount).catch(console.error);
  }
  if (releaseCount > 0) {
    await releaseReservedCredits(userId, releaseCount).catch(console.error);
  }

  const channelId = resolveJobChannelId(params.jobRecord || null);
  if (channelId) {
    await decrementChannelVideosOnHold(userId, channelId, requestedCount).catch((error) => {
      console.warn(`[Webhook] Failed to decrement channel hold (${params.source}) for user ${userId}, channel ${channelId}:`, error);
    });
  }

  await reconcileUserHoldCounters(userId).catch((error) => {
    console.warn(`[Webhook] Failed to reconcile hold counters (${params.source}) for user ${userId}:`, error);
  });
};

// @desc    Receive job status updates from Python pipeline
// @route   POST /api/webhook/job-status
// @access  Private (verified via x-webhook-secret)
export const handleJobStatusWebhook = asyncHandler(async (req: Request, res: Response) => {
  const incomingBody = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
  console.log('[Webhook] Received job-status payload meta:', {
    jobId: typeof incomingBody.jobId === 'string' ? incomingBody.jobId : '',
    status: typeof incomingBody.status === 'string' ? incomingBody.status : '',
    hasLogs: typeof incomingBody.logs === 'string' && incomingBody.logs.length > 0,
    hasVideoUrl: typeof incomingBody.videoUrl === 'string' && incomingBody.videoUrl.length > 0,
    hasYoutubeVideoId: typeof incomingBody.youtubeVideoId === 'string' && incomingBody.youtubeVideoId.length > 0,
  });
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
    const idempotencyHash = crypto
      .createHash('sha1')
      .update(
        JSON.stringify({
          status: String(status || '').toLowerCase(),
          videoUrl: String(videoUrl || '').trim(),
          youtubeVideoId: String(youtubeVideoId || '').trim(),
          errorMessage: String(errorMessage || '').trim(),
          errorStage: String(errorStage || '').trim(),
          processedVideos: Number(processedVideos),
          logsTail: typeof logs === 'string' ? logs.slice(-120) : '',
        })
      )
      .digest('hex')
      .slice(0, 32);
    // Include payload fingerprint so later updates with same status are not dropped.
    const idempotencyKey = `webhook:idempotency:${jobId}:${idempotencyHash}`;
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

  const acceptedYouTubeLimitWarning = Boolean((job as any)?.acceptedYouTubeLimitWarning);

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
  const uploadDisabled = (job as any)?.pipelineConfig?.upload === false;
  const requiresUpload = !uploadDisabled && Boolean(
    (job as any)?.pipelineConfig?.upload === true ||
    (job as any)?.pipelineConfig?.autoUpload === true ||
    (job as any)?.pipelineConfig?.autoUploadSchedule === true ||
    (job as any)?.pipelineConfig?.scheduleEnabled === true ||
    (job as any)?.pipelineConfig?.publishNow === true ||
    (typeof (job as any)?.pipelineConfig?.channelId === 'string' && (job as any).pipelineConfig.channelId.trim().length > 0)
  );
  const requestedCount = Math.max(1, Number(job.videoCount || 1));
  const processedCountRaw = typeof processedVideos === 'number' && processedVideos >= 0
    ? processedVideos
    : (typeof job.processedVideos === 'number' && job.processedVideos >= 0 ? job.processedVideos : 0);
  const processedCount = Math.min(requestedCount, Math.max(0, Math.floor(processedCountRaw)));
  const successfulUploadsHint = clampSuccessfulUploads(requestedCount, processedCountRaw);

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
     const successSettlement = resolveSettlementCounts({
       requestedCount,
       successfulUploads: typeof successfulUploadsHint === 'number' ? successfulUploadsHint : requestedCount,
       uploadFailure: false,
       acceptedYouTubeLimitWarning,
     });

     if (!uploadConfirmed) {
       await JobModel.updateOne(
         { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
         {
           $set: {
             status: 'processing',
             progress: {
               progress: 95,
               stage: 'upload_confirmation_pending',
               message: 'Waiting for final upload confirmation',
               timestamp: new Date().toISOString(),
             },
             result: {
               ...(job.result || {}),
               success: false,
               uploadConfirmed: false,
               videoUrl: resolvedVideoUrl || '',
               youtubeVideoId: resolvedYoutubeVideoId || '',
             },
           },
         }
       );
       await job.save();
       res.status(200).json({ success: true, deferred: true });
       return;
     }

     const updatedJob = await JobModel.findOneAndUpdate(
       { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
       {
         $set: {
           status: 'success',
           completedAt: new Date(),
            holdConsumed: successSettlement.consumeCount > 0,
            holdReleased: successSettlement.releaseCount > 0,
           errorMessage: '',
           errorStage: undefined as any,
            processedVideos: successSettlement.consumeCount,
            ...(resolvedVideoUrl ? { videoUrl: resolvedVideoUrl } : {}),
            ...(resolvedYoutubeVideoId ? { youtubeVideoId: resolvedYoutubeVideoId } : {}),
            progress: {
              progress: 100,
              stage: 'completed',
              message: 'Job completed successfully',
              timestamp: new Date().toISOString(),
            },
           result: {
             success: true,
             uploadConfirmed: true,
             videoUrl: resolvedVideoUrl || '',
             youtubeVideoId: resolvedYoutubeVideoId || '',
           }
         }
       },
       { new: true }
     );
     if (updatedJob) {
       await settleGlobalAndChannelHolds({
         userId: updatedJob.userId.toString(),
         requestedCount,
         consumeCount: successSettlement.consumeCount,
         releaseCount: successSettlement.releaseCount,
         jobRecord: updatedJob as any,
         source: 'job-status:success',
       });
       await appendRecentTopic(updatedJob.userId.toString(), String((updatedJob as any).chosenSubTopic || '')).catch(console.error); // FIXED: Update user recent topics after webhook-confirmed success.
       await applyUserJobHistoryRetention(updatedJob.userId.toString()).catch((error) => {
         console.warn(`[Webhook] Failed to apply job history retention for user ${updatedJob.userId}:`, error);
       });
     } else {
       console.log(`[Webhook] Job ${jobId} already processed (success). Skipping duplicate update.`);
     }
  } else if (normalizedStatus === 'failed') {
     const resolvedError = (typeof errorMessage === 'string' && errorMessage.trim()) ? errorMessage.trim() : (logs || 'Failed via webhook');
     const parsedErrorStage = (typeof errorStage === 'string' && ['TOKEN', 'CONTENT_GENERATION', 'RENDER', 'UPLOAD'].includes(errorStage)) ? errorStage as any : undefined;
     const isUploadFailure = parsedErrorStage === 'UPLOAD' || isYouTubeLimitFailure(resolvedError);
     const failureSettlement = resolveSettlementCounts({
       requestedCount,
       ...(typeof successfulUploadsHint === 'number' ? { successfulUploads: successfulUploadsHint } : {}),
       uploadFailure: isUploadFailure,
       acceptedYouTubeLimitWarning,
     });

     const updatedJob = await JobModel.findOneAndUpdate(
       { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
       {
         $set: {
           status: 'failed',
           completedAt: new Date(),
           holdConsumed: failureSettlement.consumeCount > 0,
           holdReleased: failureSettlement.releaseCount > 0,
           processedVideos: failureSettlement.consumeCount,
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
       await settleGlobalAndChannelHolds({
         userId: updatedJob.userId.toString(),
         requestedCount,
         consumeCount: failureSettlement.consumeCount,
         releaseCount: failureSettlement.releaseCount,
         jobRecord: updatedJob as any,
         source: 'job-status:failed',
       });
       await applyUserJobHistoryRetention(updatedJob.userId.toString()).catch((error) => {
         console.warn(`[Webhook] Failed to apply job history retention for user ${updatedJob.userId}:`, error);
       });
     } else {
       console.log(`[Webhook] Job ${jobId} already processed (failed). Skipping duplicate update.`);
     }
  } else if (normalizedStatus === 'youtube_rejected') {
     const resolvedError = (typeof errorMessage === 'string' && errorMessage.trim()) ? errorMessage.trim() : 'YouTube limits rejected the upload';
      const rejectedSettlement = resolveSettlementCounts({
        requestedCount,
        ...(typeof successfulUploadsHint === 'number' ? { successfulUploads: successfulUploadsHint } : {}),
        uploadFailure: true,
        acceptedYouTubeLimitWarning,
      });

     const updatedJob = await JobModel.findOneAndUpdate(
       { _id: jobId, status: { $in: ['processing', 'pending'] }, holdConsumed: false, holdReleased: false },
       {
         $set: {
           status: 'failed',
           completedAt: new Date(),
           holdConsumed: rejectedSettlement.consumeCount > 0,
           holdReleased: rejectedSettlement.releaseCount > 0,
           processedVideos: rejectedSettlement.consumeCount,
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
       await settleGlobalAndChannelHolds({
         userId: updatedJob.userId.toString(),
         requestedCount,
         consumeCount: rejectedSettlement.consumeCount,
         releaseCount: rejectedSettlement.releaseCount,
         jobRecord: updatedJob as any,
         source: 'job-status:youtube_rejected',
       });
       await applyUserJobHistoryRetention(updatedJob.userId.toString()).catch((error) => {
         console.warn(`[Webhook] Failed to apply job history retention for user ${updatedJob.userId}:`, error);
       });
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
  const incomingBody = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
  const resultObj = incomingBody.result && typeof incomingBody.result === 'object'
    ? incomingBody.result as Record<string, unknown>
    : null;
  console.log('[Webhook] Received pipeline-complete payload meta:', {
    jobId: typeof incomingBody.jobId === 'string' ? incomingBody.jobId : '',
    status: typeof incomingBody.status === 'string' ? incomingBody.status : '',
    resultStatus: resultObj && typeof resultObj.status === 'string' ? resultObj.status : '',
    hasResult: Boolean(resultObj),
    hasVideoUrl: Boolean(
      (resultObj && typeof resultObj.videoUrl === 'string' && resultObj.videoUrl.length > 0) ||
      (resultObj && resultObj.result && typeof (resultObj.result as Record<string, unknown>).videoUrl === 'string')
    ),
  });
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
      .slice(0, 32);
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

  const resolvedUserId = String(payload.userId || resultPayload?.userId || '').trim();
  if (!resolvedUserId) {
    res.status(400).json({ error: 'Missing userId in pipeline-complete payload' });
    return;
  }
  if (job.userId.toString() !== resolvedUserId) {
    res.status(403).json({ error: 'Job does not belong to this user' });
    return;
  }

  const acceptedYouTubeLimitWarning = Boolean((job as any)?.acceptedYouTubeLimitWarning);

  const uploadRequested = typeof resultPayload?.uploadRequested === 'boolean'
    ? resultPayload.uploadRequested
    : (job.pipelineConfig?.upload !== false);
  const uploadSkipped = Boolean(resultPayload?.uploadSkipped);
  const uploadConfirmed = !uploadRequested || uploadSkipped || Boolean(
    resolvedYoutubeVideoId ||
    (resolvedVideoUrl && /^https?:\/\//i.test(resolvedVideoUrl))
  );

  const requestedCount = Math.max(1, Number(job.videoCount || 1));
  const warningList = Array.isArray(resultPayload?.metadata?.warnings)
    ? resultPayload.metadata.warnings.map((warning: unknown) => String(warning || '').toLowerCase())
    : [];
  const uploadWarning = warningList.find((warning: string) => warning.includes('upload_error'));
  const rawFailureMessage = String(resultPayload?.errorMessage || payload?.errorMessage || '').trim();
  const hintedErrorStageRaw = String(resultPayload?.errorStage || payload?.errorStage || '').trim().toUpperCase();
  const hintedErrorStage = ['TOKEN', 'CONTENT_GENERATION', 'RENDER', 'UPLOAD'].includes(hintedErrorStageRaw)
    ? hintedErrorStageRaw
    : '';
  const successfulUploadsHintRaw = Number(
    resultPayload?.successfulUploads ??
    resultPayload?.result?.successfulUploads ??
    resultPayload?.processedVideos ??
    resultPayload?.result?.processedVideos ??
    resultPayload?.metadata?.successfulUploads ??
    resultPayload?.metadata?.processedVideos
  );
  const successfulUploadsHint = Number.isFinite(successfulUploadsHintRaw)
    ? Math.max(0, Math.min(requestedCount, Math.floor(successfulUploadsHintRaw)))
    : undefined;

  let nextStatus: 'success' | 'failed' | 'processing' = 'processing';
  if (statusHint && ['failed', 'error', 'errored'].includes(statusHint)) {
    nextStatus = 'failed';
  } else if (uploadWarning && uploadRequested && !uploadConfirmed) {
    nextStatus = 'failed';
  } else if (!uploadRequested || uploadSkipped || uploadConfirmed) {
    nextStatus = 'success';
  }

  const uploadFailure = nextStatus === 'failed' && uploadRequested && (
    !uploadConfirmed ||
    Boolean(uploadWarning) ||
    hintedErrorStage === 'UPLOAD' ||
    statusHint === 'youtube_rejected' ||
    isYouTubeLimitFailure(rawFailureMessage)
  );

  const settlement = nextStatus === 'success'
    ? resolveSettlementCounts({
        requestedCount,
        successfulUploads: typeof successfulUploadsHint === 'number' ? successfulUploadsHint : requestedCount,
        uploadFailure: false,
        acceptedYouTubeLimitWarning,
      })
    : resolveSettlementCounts({
        requestedCount,
        ...(typeof successfulUploadsHint === 'number' ? { successfulUploads: successfulUploadsHint } : {}),
        uploadFailure,
        acceptedYouTubeLimitWarning,
      });

  const failureMessage = nextStatus === 'failed'
    ? (rawFailureMessage ||
        (uploadWarning ? String(uploadWarning).replace(/^upload_error:/, '').trim() : '') ||
        (uploadConfirmed ? 'Pipeline failed' : 'Upload failed or was skipped.'))
    : '';
  const failureStage = nextStatus === 'failed'
    ? (uploadFailure ? 'UPLOAD' : (hintedErrorStage || undefined))
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
        holdConsumed: settlement.consumeCount > 0,
        holdReleased: settlement.releaseCount > 0,
        processedVideos: settlement.consumeCount,
        error: nextStatus === 'failed' ? failureMessage : undefined,
        errorMessage: nextStatus === 'failed' ? failureMessage : '',
        errorStage: nextStatus === 'failed' ? failureStage : undefined,
      },
    },
    { new: true }
  );

  if (finalized) {
    await settleGlobalAndChannelHolds({
      userId: finalized.userId.toString(),
      requestedCount,
      consumeCount: settlement.consumeCount,
      releaseCount: settlement.releaseCount,
      jobRecord: finalized as any,
      source: 'pipeline-complete:finalized',
    });
    if (nextStatus === 'success') {
      await appendRecentTopic(finalized.userId.toString(), String((finalized as any).chosenSubTopic || '')).catch(console.error);
    }
    await applyUserJobHistoryRetention(finalized.userId.toString()).catch((error) => {
      console.warn(`[Webhook] Failed to apply job history retention for user ${finalized.userId}:`, error);
    });
    res.status(200).json({ success: true });
    return;
  }

  await JobModel.updateOne(
    { _id: jobId },
    { $set: updatePayload }
  );

  res.status(200).json({ success: true });
});
