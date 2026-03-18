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

First, silently classify the user's input into one of these categories: Tech, Story, News, Educational, Viral/List, or General (fallback).

Then, generate the script prompt using the exact structure required for that category:
- Tech: Hook -> Problem -> Solution -> Insight -> CTA
- Story: Hook -> Build suspense -> Twist -> Cliffhanger -> CTA
- News: Hook -> Key info -> Impact -> Quick summary -> CTA
- Educational: Hook (Question) -> Explanation -> Insight -> CTA
- Viral/List: Hook -> Points -> Fast pacing -> CTA
- General (fallback): Hook -> Curiosity -> Main content -> Twist -> CTA

ABSOLUTE RULES:
1. HOOK: The very first line (0-3s) MUST be a strong hook using curiosity, shock, or a compelling question (e.g., "You won't believe...", "What if I told you...").
2. VARIATION: Generate fresh, creative wording every single time. Never use generic or repetitive content.
3. CTA: The final line MUST be a dynamic CTA tailored to the topic (e.g., "Follow for daily tech hacks" for Tech, "Follow for part 2" for Story).
4. OUTPUT: Provide ONLY the final optimized script prompt text. Do not output JSON, do not include the classification name, and do not include unnecessary explanations. Make it directly usable for the video generation pipeline.`,
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
