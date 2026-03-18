import { GoogleGenerativeAI } from '@google/generative-ai';
import { AppError } from '../middleware/errorHandler';

export const generateGeminiPrompt = async (user_prompt: string): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new AppError('Gemini API Key is not configured', 500);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // We use gemini-1.5-flash for fast text generation
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: `You are an elite YouTube Shorts content strategist. Your task is to transform the user's raw idea into a highly optimized, viral-ready script prompt.

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
4. OUTPUT: Provide ONLY the final optimized script prompt text. Do not output JSON, do not include the confidence score, do not include the classification name, and do not include unnecessary explanations. Make it directly usable for the video generation pipeline.`,
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
      throw new Error('Received empty response from Gemini');
    }

    // Clean and trim the output
    const cleanedOutput = responseText.trim();

    return cleanedOutput;
  } catch (error) {
    console.error('Gemini API Error:', error);
    // Throw a safe error message without leaking internal details
    throw new AppError('Failed to generate video prompt. Please try again later.', 500);
  }
};
