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
      systemInstruction: "You are an expert YouTube Shorts script writer. Take the user's idea and transform it into a highly engaging short-form video script. Structure it with a strong hook, fast-paced storytelling, clear scene progression, and a compelling ending. Optimize for virality and audience retention. Ensure output is clean, structured, no unnecessary explanation, and directly usable for video generation.",
    });

    const result = await model.generateContent(user_prompt);
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
