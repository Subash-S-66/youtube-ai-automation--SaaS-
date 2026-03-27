import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { RunPipelineInput } from '../utils/validators/pipelineValidators';
import { enqueuePipelineJob } from '../services/pipelineRunService';
import Job from '../models/Job';
import Prompt from '../models/Prompt';
import { buildStandardPrompt, extractTopicValue } from '../services/promptBuilderService';

// @desc    Get user's jobs
// @route   GET /api/pipeline/jobs
// @access  Private
export const getJobs = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const limit = parseInt(req.query.limit as string) || 10;
  const cursor = req.query.cursor as string;
  const query: any = { userId: req.user.id };

  if (cursor) {
    // cursor based pagination using _id which contains timestamp
    query._id = { $lt: cursor };
  }

  // Request limit + 1 to check if there is a next page
  const jobs = await Job.find(query).sort({ _id: -1 }).limit(limit + 1);

  let nextCursor = null;
  if (jobs.length > limit) {
    const nextJob = jobs.pop();
    nextCursor = nextJob?._id;
  }

  const total = await Job.countDocuments({ userId: req.user.id });

  res.status(200).json({
    success: true,
    data: jobs,
    pagination: {
      limit,
      total,
      nextCursor,
    },
  });
});

// @desc    Add generation pipeline job to queue
// @route   POST /api/pipeline/run
// @access  Private
export const startPipeline = asyncHandler(
  async (req: Request<unknown, unknown, RunPipelineInput>, res: Response) => {
    const { promptId, settings, acceptedYouTubeLimitWarning, title, prompt, videoSize, duration, tone, style } = req.body;

    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    const userId = req.user.id;
    let resolvedPromptId = promptId;
    let standardizedPrompt = '';

    if (!resolvedPromptId) {
      standardizedPrompt = buildStandardPrompt({
        title,
        prompt,
        videoSize,
        duration: typeof duration === 'number' ? duration : settings?.duration,
        tone,
        style,
      });

      const createdPrompt = await Prompt.create({
        userId,
        user_prompt: extractTopicValue(prompt || title || standardizedPrompt),
        gemini_prompt: standardizedPrompt,
      });
      resolvedPromptId = createdPrompt._id.toString();
    }

    if (!resolvedPromptId) {
      throw new AppError('Failed to resolve promptId for pipeline run.', 400);
    }

    const params: { userId: string; promptId: string; settings: Record<string, any>; acceptedYouTubeLimitWarning?: boolean } = {
      userId,
      promptId: resolvedPromptId,
      settings,
    };
    if (typeof acceptedYouTubeLimitWarning === 'boolean') {
      params.acceptedYouTubeLimitWarning = acceptedYouTubeLimitWarning;
    }

    const result = await enqueuePipelineJob(params);

    if (result.warningOnly) {
      return res.status(400).json({
        success: false,
        message: result.warning,
        warning: result.warning,
      });
    }

    res.status(200).json({
      success: true,
      jobId: result.jobId,
      message: 'Job added to queue',
      plan: result.plan,
      remainingUploads: result.remainingUploads,
      uploadsOnHold: result.uploadsOnHold || 0,
      warning: result.warning,
      standardizedPrompt: result.standardizedPrompt || standardizedPrompt || undefined,
      generatedScript: result.generatedScript || undefined,
      metadata: result.metadata || undefined,
    });
  }
);
