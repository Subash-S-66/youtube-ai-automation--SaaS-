import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { RunPipelineInput } from '../utils/validators/pipelineValidators';
import Prompt from '../models/Prompt';
import { getValidYouTubeToken } from '../services/youtubeTokenService';
import Job from '../models/Job';
import { pipelineQueue } from '../queues/pipelineQueue';

// @desc    Add generation pipeline job to queue
// @route   POST /api/pipeline/run
// @access  Private
export const startPipeline = asyncHandler(
  async (req: Request<unknown, unknown, RunPipelineInput>, res: Response) => {
    const { promptId, settings } = req.body;

    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    const userId = req.user.id;

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

    // Create a new job document
    const job = await Job.create({
      userId,
      promptId,
      status: 'pending',
      logs: 'Job added to queue...\n',
    });

    // Add job to BullMQ
    await pipelineQueue.add('runPipeline', {
      userId,
      promptId,
      jobId: job._id.toString(),
      settings,
    });

    res.status(200).json({
      success: true,
      jobId: job._id.toString(),
      message: 'Job added to queue',
    });
  }
);
