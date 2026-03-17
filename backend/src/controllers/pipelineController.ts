import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { RunPipelineInput } from '../utils/validators/pipelineValidators';
import Prompt from '../models/Prompt';
import { getValidYouTubeToken } from '../services/youtubeTokenService';
import { runPipeline } from '../services/pipelineService';
import Job from '../models/Job';

// @desc    Run the generation pipeline
// @route   POST /api/pipeline/run
// @access  Private
export const startPipeline = asyncHandler(
  async (req: Request<unknown, unknown, RunPipelineInput>, res: Response) => {
    const { promptId, settings } = req.body;

    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    const userId = req.user.id;

    // Check for a running job here to prevent unneeded DB queries
    const existingJob = await Job.findOne({ userId, status: 'running' });
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

    // Verify YouTube token exists
    let youtubeToken = '';
    try {
        youtubeToken = await getValidYouTubeToken(userId);
    } catch (error) {
        throw new AppError('YouTube is not connected or token is invalid. Please connect your account first.', 400);
    }

    if (!youtubeToken) {
        throw new AppError('YouTube is not connected or token is invalid. Please connect your account first.', 400);
    }

    // Call Pipeline Service to trigger process asynchronously
    const jobId = await runPipeline(userId, promptId, prompt.gemini_prompt, settings, youtubeToken);

    res.status(200).json({
      success: true,
      jobId: jobId,
      message: 'Pipeline started',
    });
  }
);
