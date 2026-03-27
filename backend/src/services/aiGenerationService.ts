import { GoogleGenerativeAI } from '@google/generative-ai';
import { AppError } from '../middleware/errorHandler';

export interface AIGenerationResult {
  text: string;
  provider: 'jules' | 'fallback';
}

const callJules = async (prompt: string, timeoutMs = 45000): Promise<string> => {
  const julesUrl = process.env.JULES_API_URL || '';
  const julesKey = process.env.JULES_API_KEY || '';
  if (!julesUrl || !julesKey) {
    throw new Error('Jules API is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(julesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${julesKey}`,
      },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jules HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json() as any;
    const out = (data?.output_text || data?.response || data?.text || '').toString().trim();
    if (!out) {
      throw new Error('Jules returned empty response');
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
};

const callFallbackModel = async (prompt: string, timeoutMs = 45000): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new Error('Fallback model key is not configured');
  }

  const modelName = (process.env.GEMINI_MODEL || 'gemini-3.1-flash-preview').trim();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
      },
    });
    const out = (result.response.text() || '').trim();
    if (!out) {
      throw new Error('Fallback model returned empty response');
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
};

export const generateFromAI = async (prompt: string): Promise<AIGenerationResult> => {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) {
    throw new AppError('Prompt is required for AI generation.', 400);
  }

  try {
    const text = await callJules(normalizedPrompt);
    return { text, provider: 'jules' };
  } catch (julesError: any) {
    try {
      const text = await callFallbackModel(normalizedPrompt);
      return { text, provider: 'fallback' };
    } catch (fallbackError: any) {
      throw new AppError(
        `AI generation failed. Jules: ${julesError?.message || 'unknown'} | Fallback: ${fallbackError?.message || 'unknown'}`,
        502
      );
    }
  }
};
