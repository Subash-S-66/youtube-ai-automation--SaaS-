import { GoogleGenerativeAI } from '@google/generative-ai';
import { AppError } from '../middleware/errorHandler';

export interface AIGenerationResult {
  text: string;
  provider: 'gemini';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseTimeoutMs = (raw: unknown, fallback: number): number => {
  const rawText = String(raw ?? '').trim();
  if (!rawText) {
    return fallback;
  }
  const parsed = Number(rawText);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  // Treat small values as seconds to avoid common env misconfiguration (e.g. "15" => 15s, not 15ms).
  const normalized = parsed > 0 && parsed <= 300 ? parsed * 1000 : parsed;
  return Math.max(1000, Math.floor(normalized));
};

const GEMINI_TIMEOUT_MS = parseTimeoutMs(process.env.GEMINI_TIMEOUT_MS, 15000);

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const isQuotaOrRateLimit = (message: string): boolean => {
  const lower = String(message || '').toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  );
};

const callNativeGemini = async (prompt: string, timeoutMs = GEMINI_TIMEOUT_MS): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  console.log(`[AIService] Trying Native Google Gemini model: ${modelName}`);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const result = await withTimeout(
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
      },
    }),
    timeoutMs,
    'Native Gemini request'
  );

  const out = (result.response.text() || '').trim();
  if (!out) {
    throw new Error('Native Gemini returned empty response');
  }

  return out;
};

const validateAIOutput = (text: string): void => {
  if (!text || text.trim().length === 0) {
    throw new Error('AI output is empty');
  }
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 20) {
    throw new Error('AI output is too short (less than 20 words)');
  }
  const lowerText = text.toLowerCase();
  // Detect when AI echoes back the system prompt instead of generating content
  const promptLeakPatterns = [
    'you are an elite youtube',
    'you are a premium youtube shorts director',
    'return only valid json',
    'your task is to convert a raw user topic',
    'narration brief (this is what the video is about',
  ];
  if (promptLeakPatterns.some(p => lowerText.includes(p))) {
    throw new Error('AI output contains prompt instructions instead of generated content');
  }
};

export const generateFromAI = async (prompt: string): Promise<AIGenerationResult> => {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) {
    throw new AppError('Prompt is required for AI generation.', 400);
  }

  const retryDelaysMs = [2000, 5000, 10000];
  let lastError: any = null;
  for (let attempt = 1; attempt <= retryDelaysMs.length + 1; attempt++) {
    try {
      const text = await callNativeGemini(normalizedPrompt);
      validateAIOutput(text);
      console.log('[AIService] Successfully generated content using native-gemini');
      return { text, provider: 'gemini' };
    } catch (error: any) {
      lastError = error;
      const message = String(error?.message || 'unknown error');
      if (!isQuotaOrRateLimit(message) || attempt > retryDelaysMs.length) {
        break;
      }
      const delay = retryDelaysMs[attempt - 1] ?? 2000;
      console.warn(`[AIService] Gemini rate-limited (attempt ${attempt}). Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  try {
    const message = String(lastError?.message || 'unknown error');
    if (isQuotaOrRateLimit(message)) {
      throw new AppError(
        `AI generation failed (gemini quota/rate limit): ${message}`,
        429
      );
    }
    throw new AppError(`AI generation failed (native-gemini): ${message}`, 502);
  } catch (error) {
    throw error;
  }
};
