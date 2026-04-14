import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { generatePrompt as generateAIPrompt } from '../services/promptGenerationService';
import Prompt from '../models/Prompt';
import { GeneratePromptInput } from '../utils/validators/promptValidators';
import { AppError } from '../middleware/errorHandler';
import type { PromptGenerationOptions } from '../services/promptGenerationService';

// @desc    Generate a new script prompt via Gemini
// @route   POST /api/prompt/generate
// @access  Private
export const generatePrompt = asyncHandler(
  async (req: Request<unknown, unknown, GeneratePromptInput>, res: Response) => {
    const startedAt = Date.now();
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

    // Call AI Prompt Service (Gemini only)
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

    let generated_prompt = '';
    let usedFallbackPrompt = false;
    let fallbackWarning = '';
    try {
      console.log(
        `[PromptController] generate start user=${req.user.id} promptChars=${String(user_prompt || '').length}`
      );
      generated_prompt = await generateAIPrompt(user_prompt, promptOptions);
    } catch (error: any) {
      const statusCode = Number(error?.statusCode || error?.response?.status || 0);
      const message = String(error?.message || 'Prompt generation failed');
      const normalized = message.toLowerCase();
      const trimmedUserPrompt = String(user_prompt || '').trim();
      const canFallbackToUserPrompt = Boolean(trimmedUserPrompt);
      const isTransientProviderFailure =
        statusCode === 429 ||
        statusCode === 503 ||
        statusCode === 504 ||
        normalized.includes('429') ||
        normalized.includes('too many requests') ||
        normalized.includes('quota') ||
        normalized.includes('rate limit') ||
        normalized.includes('timed out') ||
        normalized.includes('timeout') ||
        normalized.includes('service unavailable') ||
        normalized.includes('high demand');
      console.error(
        `[PromptController] generate failed user=${req.user.id} status=${statusCode || 'n/a'} elapsedMs=${
          Date.now() - startedAt
        } message=${message}`
      );
      if (isTransientProviderFailure && canFallbackToUserPrompt) {
        generated_prompt = trimmedUserPrompt;
        usedFallbackPrompt = true;
        fallbackWarning =
          'AI prompt service was unavailable. Using your original prompt so the job can continue in the background.';
        console.warn(
          `[PromptController] generate fallback user=${req.user.id} elapsedMs=${Date.now() - startedAt} reason=${message}`
        );
      }

      if (usedFallbackPrompt) {
        // Continue with fallback prompt persistence and response below.
      } else if (statusCode >= 400 && statusCode < 600) {
        throw new AppError(message, statusCode);
      } else if (
        normalized.includes('429') ||
        normalized.includes('too many requests') ||
        normalized.includes('quota') ||
        normalized.includes('rate limit')
      ) {
        throw new AppError(`Prompt generation rate-limited by Gemini. ${message}`, 429);
      } else if (normalized.includes('timed out') || normalized.includes('timeout')) {
        throw new AppError(
          'Prompt generation timed out while waiting for the AI provider. Please retry in a few seconds.',
          504
        );
      } else {
        throw new AppError(message, 502);
      }
    }

    // Save prompt pair to DB
    const newPrompt = await Prompt.create({
      userId: req.user.id,
      user_prompt,
      gemini_prompt: generated_prompt,
    });

    res.status(201).json({
      promptId: newPrompt._id,
      gemini_prompt: generated_prompt,
      fallbackUsed: usedFallbackPrompt,
      warning: usedFallbackPrompt ? fallbackWarning : undefined,
    });
    console.log(
      `[PromptController] generate success user=${req.user.id} elapsedMs=${Date.now() - startedAt} promptId=${String(
        newPrompt._id
      )}`
    );
  }
);
