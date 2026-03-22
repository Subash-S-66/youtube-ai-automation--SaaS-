import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { RunPipelineInput } from '../utils/validators/pipelineValidators';
import { enqueuePipelineJob } from '../services/pipelineRunService';
import Job from '../models/Job';

// @desc    Get user's jobs
// @route   GET /api/pipeline/jobs
// @access  Private
export const getJobs = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !req.user.id) {
    throw new AppError('Not authorized', 401);
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;

  const query: any = { userId: req.user.id };

  const skip = (page - 1) * limit;

  // We could implement search if the job had searchable strings. Currently mostly ID/Status
  // For basic usage, paginating is good enough for performance.
  const jobs = await Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);
  const total = await Job.countDocuments(query);

  res.status(200).json({
    success: true,
    data: jobs,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
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
    const params: { userId: string; promptId: string; settings: Record<string, any>; acceptedYouTubeLimitWarning?: boolean } = {
      userId,
      promptId,
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
    });
  }
);
