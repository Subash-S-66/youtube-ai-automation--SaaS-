import { GoogleGenerativeAI } from '@google/generative-ai';
import { AppError } from '../middleware/errorHandler';

export interface AIGenerationResult {
  text: string;
  provider: 'jules' | 'fallback';
}

const callOpenRouter = async (prompt: string, modelName: string, timeoutMs = 15000): Promise<string> => {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  console.log(`[AIService] Trying OpenRouter model: ${modelName}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    const data = await response.json() as any;

    if (!response.ok || data?.error) {
      const errorMsg = data?.error?.message || await response.text();
      console.error(`[aiGenerationService] API error for ${modelName}:`, errorMsg);
      throw new Error(`OpenRouter HTTP ${response.status}: ${errorMsg}`);
    }

    const result = (data?.choices?.[0]?.message?.content || '').toString().trim();
    if (!result) {
        console.error(`[aiGenerationService] OpenRouter returned short/empty result`, JSON.stringify(data).slice(0, 200));
        throw new Error(`OpenRouter empty response (data payload: ${JSON.stringify(data).slice(0, 50)})`);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
};

const callNativeGemini = async (prompt: string, timeoutMs = 15000): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
  console.log(`[AIService] Trying Native Google Gemini model: ${modelName}`);
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
      throw new Error('Native Gemini returned empty response');
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
};

const validateAIOutput = (text: string): void => {
  if (!text || text.trim().length === 0) {
    throw new Error('AI output is empty');
  }
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 3) {
    throw new Error('AI output is too short (less than 3 lines)');
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

  const modelsToTry = [
    { name: 'openrouter/free', type: 'openrouter' },
    { name: 'meta-llama/llama-3.3-70b-instruct:free', type: 'openrouter' },
    { name: 'nousresearch/hermes-3-llama-3.1-405b:free', type: 'openrouter' },
    { name: 'native-gemini', type: 'native' }
  ];

  const errors: string[] = [];

  for (const modelConfig of modelsToTry) {
    try {
      let text = '';
      if (modelConfig.type === 'openrouter') {
        text = await callOpenRouter(normalizedPrompt, modelConfig.name);
      } else {
        text = await callNativeGemini(normalizedPrompt);
      }
      
      validateAIOutput(text);
      console.log(`[AIService] Successfully generated content using ${modelConfig.name}`);
      return { text, provider: 'fallback' }; // provider string doesn't matter anymore, keeping as default 'fallback'
    } catch (error: any) {
      console.warn(`[AIService] Failed using ${modelConfig.name}: ${error?.message}`);
      errors.push(`${modelConfig.name}: ${error?.message}`);
    }
  }

  throw new AppError(`AI generation failed on all models: ${errors.join(' | ')}`, 502);
};
