import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { RunPipelineInput } from '../utils/validators/pipelineValidators';
import Prompt from '../models/Prompt';
import { getValidYouTubeToken } from '../services/youtubeTokenService';
import Job from '../models/Job';
import User from '../models/User';
import { pipelineQueue } from '../queues/pipelineQueue';
import { canUserUpload } from '../services/uploadLimitService';

// @desc    Get user's jobs
// @route   GET /api/pipeline/jobs
// @access  Private
export const getJobs = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const jobs = await Job.find({ userId: req.user.id }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: jobs,
  });
});

// @desc    Add generation pipeline job to queue
// @route   POST /api/pipeline/run
// @access  Private
export const startPipeline = asyncHandler(
  async (req: Request<unknown, unknown, RunPipelineInput>, res: Response) => {
    const { promptId, settings, acceptedYouTubeLimitWarning } = req.body;

    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    const userId = req.user.id;

    // Check Upload Limits
    const limitCheck = await canUserUpload(userId);
    if (!limitCheck.allowed) {
      throw new AppError(limitCheck.message || 'Daily upload limit reached', 403);
    }

    // Check for a running or pending job here to prevent multiple queued tasks
    const existingJob = await Job.findOne({
      userId,
      status: { $in: ['pending', 'running'] }
    });

    if (existingJob) {
      throw new AppError('A process is already running', 400);
    }

    // Fetch prompt
    const prompt = await Prompt.findById(promptId);
    if (!prompt) {
      throw new AppError('Prompt not found', 404);
    }

    if (prompt.userId.toString() !== userId) {
        throw new AppError('Prompt does not belong to user', 403);
    }

    // Verify YouTube token exists before queueing
    let youtubeToken = '';
    try {
        youtubeToken = await getValidYouTubeToken(userId);
    } catch (error) {
        throw new AppError('YouTube is not connected or token is invalid. Please connect your account first.', 400);
    }

    if (!youtubeToken) {
        throw new AppError('YouTube is not connected or token is invalid. Please connect your account first.', 400);
    }

    if (settings.videoCount > 10 && !acceptedYouTubeLimitWarning) {
      return res.status(400).json({
        success: false,
        message: 'YouTube allows ~10 uploads per 24 hours. This may fail.',
        warning: 'YouTube allows ~10 uploads per 24 hours. This may fail.',
      });
    }

    // Increment uploadsOnHold for the user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { uploadsOnHold: 1 } },
      { new: true }
    );

    // Re-check remaining uploads to return accurate numbers
    const finalLimitCheck = await canUserUpload(userId);

    // Create a new job document
    const job = await Job.create({
      userId,
      promptId,
      status: 'pending',
      logs: 'Job added to queue...\n',
      acceptedYouTubeLimitWarning: !!acceptedYouTubeLimitWarning,
    });

    // Add job to BullMQ
    await pipelineQueue.add('runPipeline', {
      userId,
      promptId,
      jobId: job._id.toString(),
      settings,
    });

    const responsePayload: any = {
      success: true,
      jobId: job._id.toString(),
      message: 'Job added to queue',
      plan: finalLimitCheck.plan,
      remainingUploads: finalLimitCheck.remainingUploads,
      uploadsOnHold: finalLimitCheck.uploadsOnHold,
    };

    // Include warning if high volume is requested
    if (settings.videoCount > 10) {
      responsePayload.warning = 'YouTube allows ~10 uploads per 24 hours. This may fail.';
    }

    res.status(200).json(responsePayload);
  }
);
