import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { generateGeminiPrompt } from '../services/geminiService';
import Prompt from '../models/Prompt';
import { GeneratePromptInput } from '../utils/validators/promptValidators';
import { AppError } from '../middleware/errorHandler';

// @desc    Generate a new script prompt via Gemini
// @route   POST /api/prompt/generate
// @access  Private
export const generatePrompt = asyncHandler(
  async (req: Request<unknown, unknown, GeneratePromptInput>, res: Response) => {
    const { user_prompt } = req.body;

    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    // Call Gemini Service
    const gemini_prompt = await generateGeminiPrompt(user_prompt);

    // Save prompt pair to DB
    const newPrompt = await Prompt.create({
      userId: req.user.id,
      user_prompt,
      gemini_prompt,
    });

    // DO NOT expose gemini_prompt in response
    res.status(201).json({
      success: true,
      message: 'Prompt generated successfully',
      data: {
        id: newPrompt._id,
        user_prompt: newPrompt.user_prompt,
      },
    });
  }
);
