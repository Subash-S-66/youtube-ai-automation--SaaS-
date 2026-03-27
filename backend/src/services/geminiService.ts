import { GoogleGenerativeAI } from '@google/generative-ai';
import { AppError } from '../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT  – Converts raw user topic/idea → a tight narration brief
// that the content generator can turn into a properly timed script.
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert YouTube Shorts scriptwriter. Your ONLY job is to convert a raw user topic into a concise narration brief that tells the content generator exactly what to say, how long to say it, and what emotional arc to follow.

RETURN FORMAT (plain text, no JSON, no markdown headers):
Write exactly one paragraph of 40–90 words. The paragraph IS the narration direction. It must include:
1. A punchy opening hook sentence (curiosity, shock, or strong question)
2. The core insight or value of the topic (1–2 tight sentences)
3. A natural closing beat based on the flags below

FLAGS TO EMBED IN YOUR BRIEF:
- If CTA is enabled → end with an action line (follow, subscribe, save, share)
- If CTA is disabled → end with a thought-provoking close or a strong factual statement
- If recap is enabled → add one sentence before the close that summarises the main point in one line
- If recap is disabled → skip any recap language
- If story mode → open with a narrative hook ("Imagine…", "Picture this…", "Here's what happened…") and frame as episode N of a series
- Match tone exactly: {tone} (informational = educational clarity; casual = relaxed/relatable; dramatic = urgent/high stakes; inspirational = uplifting)

STRICT RULES:
- Every word in your output will be spoken aloud. Write for the ear, not the eye.
- No bullet points, numbered lists, section headers, or labels like "Hook:", "CTA:".
- No filler phrases ("In this video…", "Welcome back…", "Today we're going to…").
- No hashtags, no emojis.
- Keep sentences short (max 20 words each). Vary rhythm — alternate short punchy sentences with slightly longer ones.
- The first sentence must be the hook. The last sentence must match the CTA/no-CTA instruction exactly.
- Output the paragraph and nothing else.`;

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
  const tone = String(options.tone || 'informational').trim() || 'informational';
  const videoStyle = String(options.videoStyle || '').trim() || 'educational';

  // Word budget: 2.5 words per second, ±5 seconds grace
  const minWords = Math.floor((targetDuration - 5) * 2.5);
  const maxWords = Math.floor((targetDuration + 5) * 2.5);

  const storyContext = storyMode
    ? `STORY MODE: This is Part ${currentPart} of an ongoing series. Open with a narrative hook referencing part ${currentPart - 1 > 0 ? `(previous episode context)` : '(first episode, set the scene)'}.`
    : '';

  const systemWithFlags = SYSTEM_PROMPT
    .replace('{tone}', `${tone}`)
    .replace('{videoStyle}', `${videoStyle}`);

  return `${systemWithFlags}

USER TOPIC: ${user_prompt}

PIPELINE PARAMETERS:
- Target video duration: ${targetDuration} seconds
- Script word budget: ${minWords}–${maxWords} words TOTAL (the entire script must fit in this range)
- CTA enabled: ${ctaEnabled}
- Recap enabled: ${recapEnabled}
- Video style: ${videoStyle}
- Tone: ${tone}
${storyContext}

Write the narration brief now. Remember: plain paragraph, spoken aloud, ${minWords}–${maxWords} words, no labels or formatting.`;
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
        if (output && String(output).trim().split(/\s+/).length >= 10) {
          return String(output).trim();
        }
      } else {
        console.warn(`Jules API failed with status ${response.status}, falling back to Gemini...`);
      }
    } catch (e) {
      console.warn('Jules API request failed, falling back to Gemini...', e);
    }
  }

  return generateGeminiPromptDirect(fullPrompt);
};

export const generateGeminiPromptDirect = async (user_prompt: string): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('GEMINI_API_KEY not configured, using raw user prompt.');
    return user_prompt;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: user_prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 512,
      },
    });

    const responseText = result.response.text();
    if (!responseText || responseText.trim().split(/\s+/).length < 10) {
      console.warn('Gemini returned empty/short response, using raw prompt.');
      return user_prompt;
    }

    return responseText.trim();
  } catch (error) {
    console.error('Gemini API Error:', error);
    return user_prompt;
  }
};