import { GoogleGenerativeAI } from '@google/generative-ai';
import { AppError } from '../middleware/errorHandler';

const SYSTEM_PROMPT = `You are an elite YouTube Shorts content strategist. Your task is to transform the user's raw idea into a highly optimized, viral-ready script prompt.

First, silently evaluate a confidence score (0-1) on how well the user's input fits into one of these categories: Tech, Story, News, Educational, Viral/List.

If your confidence score is >= 0.6, generate the script prompt using the exact structure required for that category:
- Tech: Hook -> Problem -> Solution -> Insight -> CTA (e.g., "Follow for daily tech hacks")
- Story: Hook -> Build suspense -> Twist -> Cliffhanger -> CTA (e.g., "Follow for part 2")
- News: Hook -> Key info -> Impact -> Quick summary -> CTA (e.g., "Stay updated daily")
- Educational: Hook (Question) -> Explanation -> Insight -> CTA (e.g., "Follow to learn more")
- Viral/List: Hook -> Points -> Fast pacing -> CTA (e.g., "Subscribe for more lists")

If your confidence score is < 0.6 (or if the input is too vague/unknown), you MUST use the GENERAL VIRAL MODE structure:
- GENERAL VIRAL MODE: Hook (curiosity-based) -> Relatable setup -> Interesting insight -> Mini twist -> CTA (e.g., "Follow for more", "Stay tuned")

ABSOLUTE RULES:
1. HOOK: The very first line (0-3s) MUST be a strong hook using curiosity, shock, or a compelling question (e.g., "You won't believe...", "What if I told you...").
2. VARIATION: Generate fresh, creative wording every single time. Never use weak or generic content. Maintain high engagement quality.
3. CTA: The final line MUST be an engaging CTA (dynamic based on the topic, or "Follow for more" / "Stay tuned" if fallback).
4. OUTPUT: Provide ONLY the final optimized script prompt text. Do not output JSON, do not include the confidence score, do not include the classification name, and do not include unnecessary explanations. Make it directly usable for the video generation pipeline.`;

export interface PromptGenerationOptions {
  targetDuration?: number;
  ctaEnabled?: boolean;
  recapEnabled?: boolean;
  storyMode?: boolean;
  currentPart?: number;
  storyId?: string;
  videoCount?: number;
  videoStyle?: string;
  tone?: string;
  templateConfig?: {
    fontStyle?: string;
    subtitleColor?: string;
  };
}

const buildPromptWithOptions = (user_prompt: string, options: PromptGenerationOptions = {}): string => {
  const targetDuration = Math.max(15, Math.min(60, Number(options.targetDuration || 40)));
  const ctaEnabled = !!options.ctaEnabled;
  const recapEnabled = !!options.recapEnabled;
  const storyMode = !!options.storyMode;
  const currentPart = Math.max(1, Number(options.currentPart || 1));
  const storyId = String(options.storyId || '').trim() || 'none';
  const videoCount = Math.max(1, Math.min(10, Number(options.videoCount || 1)));
  const videoStyle = String(options.videoStyle || '').trim() || 'default';
  const tone = String(options.tone || '').trim() || 'neutral';
  const fontStyle = String(options.templateConfig?.fontStyle || 'Anton').trim() || 'Anton';
  const subtitleColor = String(options.templateConfig?.subtitleColor || '#FFFFFF').trim() || '#FFFFFF';
  return `${SYSTEM_PROMPT}

PIPELINE PARAMETERS:
- targetDuration: ${targetDuration} seconds
- ctaEnabled: ${ctaEnabled}
- recapEnabled: ${recapEnabled}
- storyMode: ${storyMode}
- currentPart: ${currentPart}
- storyId: ${storyId}
- videoCount: ${videoCount}
- videoStyle: ${videoStyle}
- tone: ${tone}
- templateConfig.fontStyle: ${fontStyle}
- templateConfig.subtitleColor: ${subtitleColor}

Return ONLY the optimised narration prompt. Do NOT return JSON.
The prompt must contain a natural-language instruction specifying:
total video duration = ${targetDuration}s,
CTA required = ${ctaEnabled},
recap required = ${recapEnabled},
story mode = ${storyMode} part ${currentPart}.

USER INPUT: ${user_prompt}`;
};

export const generateGeminiPrompt = async (user_prompt: string, options: PromptGenerationOptions = {}): Promise<string> => {
  const julesUrl = process.env.JULES_API_URL;
  const julesKey = process.env.JULES_API_KEY;
  const fullPrompt = buildPromptWithOptions(user_prompt, options);

  if (julesUrl && julesKey) {
    try {
      const response = await fetch(julesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${julesKey}`,
        },
        body: JSON.stringify({ prompt: fullPrompt }),
      });
      if (response.ok) {
        const data = await response.json();
        const output = data?.output_text || data?.response || data?.text;
        if (output) return String(output).trim();
      } else {
        console.warn(`Jules API failed with status ${response.status}, falling back to Gemini Lite...`);
      }
    } catch (e) {
      console.warn('Jules API request failed, falling back to Gemini Lite...', e);
    }
  }

  return generateGeminiPromptDirect(fullPrompt);
};

export const generateGeminiPromptDirect = async (user_prompt: string): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('AI API Keys are not configured, falling back to raw user prompt.');
    return user_prompt;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    // Add a random temperature to ensure variation
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: user_prompt }] }],
      generationConfig: {
        temperature: 0.9,
      }
    });
    const responseText = result.response.text();

    if (!responseText) {
      console.warn('Received empty response from Gemini, falling back to raw user prompt.');
      return user_prompt;
    }

    return responseText.trim();
  } catch (error) {
    console.error('Gemini API Error:', error);
    console.warn('Failed to generate video prompt, falling back to raw user prompt.');
    return user_prompt;
  }
};
