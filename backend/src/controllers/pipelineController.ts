import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { RunPipelineInput } from '../utils/validators/pipelineValidators';
import Prompt from '../models/Prompt';
import StoryProgress from '../models/StoryProgress';
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

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Concurrent Job Limit Validation
    const concurrentLimits = {
      free: 1,
      basic: 5,
      pro: 10,
      premium: 20,
    };
    const maxConcurrentJobs = concurrentLimits[user.plan] || 1;

    const activeJobsCount = await Job.countDocuments({
      userId,
      status: { $in: ['pending', 'running'] }
    });

    if (activeJobsCount >= maxConcurrentJobs) {
      throw new AppError(`Maximum concurrent jobs reached for your plan (${maxConcurrentJobs}). Please wait for an existing job to finish.`, 400);
    }

    // Find the specific channel
    const channel = user.youtubeChannels.find(c => c.channelId === settings.channelId);
    if (!channel) {
        throw new AppError(`YouTube channel with ID ${settings.channelId} not found`, 404);
    }

    // Max videosOnHold per channel limit validation
    if (channel.videosOnHold + settings.videoCount > 10) {
        throw new AppError(`Cannot queue job. This channel currently has ${channel.videosOnHold} videos running/pending. Requesting ${settings.videoCount} more exceeds the strict limit of 10 per channel.`, 400);
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
        youtubeToken = await getValidYouTubeToken(userId, settings.channelId);
    } catch (error: any) {
        throw new AppError(error.message || 'YouTube channel is not connected or token is invalid. Please reconnect.', 400);
    }

    if (!youtubeToken) {
        throw new AppError('YouTube channel is not connected or token is invalid. Please reconnect.', 400);
    }

    // Check uploads in the last 24 hours for this channel (Soft Limit)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentJobs = await Job.find({
        userId,
        channelId: settings.channelId,
        status: 'success',
        createdAt: { $gte: oneDayAgo }
    });
    const uploadsLast24h = recentJobs.reduce((sum, job) => sum + (job.videoCount || 1), 0);

    if (uploadsLast24h + settings.videoCount > 10 && !acceptedYouTubeLimitWarning) {
      return res.status(400).json({
        success: false,
        message: 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?',
        warning: 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?',
      });
    }

    // Handle Story Mode
    if (settings.storyMode && settings.storyId) {
      if (settings.resetStory) {
        await StoryProgress.findOneAndDelete({ userId, storyId: settings.storyId });
        settings.currentPart = 1;
        settings.lastPrompt = "";
      } else {
        const progress = await StoryProgress.findOne({ userId, storyId: settings.storyId });
        if (progress) {
          settings.currentPart = progress.currentPart;
          settings.lastPrompt = progress.lastPrompt;
        } else {
          settings.currentPart = 1;
          settings.lastPrompt = "";
        }
      }
    }

    // Increment uploadsOnHold (global) and channel.videosOnHold by videoCount
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, 'youtubeChannels.channelId': settings.channelId },
      {
        $inc: {
          uploadsOnHold: settings.videoCount,
          'youtubeChannels.$.videosOnHold': settings.videoCount
        }
      },
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
      videoCount: settings.videoCount,
      channelId: settings.channelId,
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
    if (uploadsLast24h + settings.videoCount > 10) {
      responsePayload.warning = 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?';
    }

    res.status(200).json(responsePayload);
  }
);
