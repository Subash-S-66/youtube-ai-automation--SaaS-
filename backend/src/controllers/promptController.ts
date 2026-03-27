import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { generateGeminiPrompt } from '../services/geminiService';
import Prompt from '../models/Prompt';
import { GeneratePromptInput } from '../utils/validators/promptValidators';
import { AppError } from '../middleware/errorHandler';
import type { PromptGenerationOptions } from '../services/geminiService';

// @desc    Generate a new script prompt via Gemini
// @route   POST /api/prompt/generate
// @access  Private
export const generatePrompt = asyncHandler(
  async (req: Request<unknown, unknown, GeneratePromptInput>, res: Response) => {
    const {
      user_prompt,
      targetDuration,
      ctaEnabled,
      recapEnabled,
      storyMode,
      currentPart,
      storyId,
      videoCount,
      videoStyle,
      tone,
      templateConfig,
    } = req.body;

    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    // Call Gemini Service
    const safeTemplateConfig = templateConfig
      ? {
          ...(templateConfig.fontStyle ? { fontStyle: templateConfig.fontStyle } : {}),
          ...(templateConfig.subtitleColor ? { subtitleColor: templateConfig.subtitleColor } : {}),
        }
      : undefined;
    const promptOptions: PromptGenerationOptions = {};
    if (targetDuration !== undefined) promptOptions.targetDuration = targetDuration;
    if (ctaEnabled !== undefined) promptOptions.ctaEnabled = ctaEnabled;
    if (recapEnabled !== undefined) promptOptions.recapEnabled = recapEnabled;
    if (storyMode !== undefined) promptOptions.storyMode = storyMode;
    if (currentPart !== undefined) promptOptions.currentPart = currentPart;
    if (storyId !== undefined) promptOptions.storyId = storyId;
    if (videoCount !== undefined) promptOptions.videoCount = videoCount;
    if (videoStyle !== undefined) promptOptions.videoStyle = videoStyle;
    if (tone !== undefined) promptOptions.tone = tone;
    if (safeTemplateConfig !== undefined) promptOptions.templateConfig = safeTemplateConfig;

    const gemini_prompt = await generateGeminiPrompt(user_prompt, promptOptions);

    // Save prompt pair to DB
    const newPrompt = await Prompt.create({
      userId: req.user.id,
      user_prompt,
      gemini_prompt,
    });

    res.status(201).json({
      promptId: newPrompt._id,
      gemini_prompt,
    });
  }
);
