import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const generateViaJulesCompat = asyncHandler(async (req: Request, res: Response) => {
  const configuredKey = process.env.JULES_API_KEY || '';
  const authHeader = req.headers.authorization || '';
  const providedKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!configuredKey) {
    throw new AppError('JULES_API_KEY is not configured on server', 500);
  }
  if (!providedKey || providedKey !== configuredKey) {
    throw new AppError('Unauthorized', 401);
  }

  const promptRaw = (req.body?.prompt ?? '').toString().trim();
  if (!promptRaw) {
    throw new AppError('prompt is required', 400);
  }

  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  if (!geminiApiKey) {
    throw new AppError('GEMINI_API_KEY is not configured on server', 500);
  }
  const modelName = (process.env.JULES_GEMINI_MODEL || 'gemini-3.1-flash-lite-preview').trim();
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: promptRaw }] }],
    generationConfig: {
      temperature: 0.2,
    },
  });
  const output = (result.response.text() || '').trim();
  if (!output) {
    throw new AppError('Empty response from Jules-compatible generator', 502);
  }

  res.status(200).json({
    success: true,
    output_text: output,
  });
});
