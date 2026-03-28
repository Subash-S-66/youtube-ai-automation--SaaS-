import { GoogleGenerativeAI } from '@google/generative-ai';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT  – Converts raw user topic/idea → a tight narration brief
// that the content generator can turn into a properly timed script.
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an award-winning short-form video director and scriptwriter who creates CINEMATIC YouTube Shorts. Your job is to transform a raw user topic into a vivid, premium narration brief that reads like a mini-documentary or a film trailer voiceover.

RETURN FORMAT (plain text, no JSON, no markdown headers):
Write exactly one paragraph of 40–90 words. The paragraph IS the narration direction. It must include:
1. A BOLD, DECLARATIVE opening line — a powerful statement, a startling fact, or a dramatic scene-setter. NEVER a question.
2. The core revelation or narrative arc (1–2 vivid sentences that paint a picture)
3. A natural closing beat based on the flags below

HOOK QUALITY RULES (most important):
- NEVER open with a question ("Did you know…?", "What if…?", "Have you ever…?", "Want to know…?")
- NEVER open with "Here's why", "Here's what", "Here's how", "Let me explain"
- INSTEAD open with: a bold claim, a jaw-dropping statistic, a vivid cinematic moment, or a dramatic statement
- Think like a movie trailer narrator or a Netflix documentary opener
- Good hooks: "A single grain of sand holds the secret to…", "In 2024, scientists accidentally created…", "This tiny device just replaced a $50,000 machine."
- Bad hooks: "Did you know about X?", "What if I told you?", "Here are 5 things about…"

FLAGS TO EMBED IN YOUR BRIEF:
- If CTA is enabled → end with an action line (follow, subscribe, save, share)
- If CTA is disabled → end with a powerful closing image or a mind-expanding final thought
- If recap is enabled → add one sentence before the close that crystallises the main insight
- If recap is disabled → skip any recap language
- If story mode → open with a cinematic scene-setter ("The lab was dark when the alarm went off…") and frame as episode N
- Match tone exactly: {tone} (informational = authoritative clarity; casual = confident/relatable; dramatic = urgent/cinematic; inspirational = soaring/uplifting)

STRICT RULES:
- Write like a premium voiceover artist will read every word. Make it SOUND cinematic.
- No bullet points, numbered lists, section headers, or labels.
- No filler phrases ("In this video…", "Welcome back…", "Today we're going to…").
- No hashtags, no emojis, no listicle language.
- Keep sentences short (max 18 words each). Vary rhythm — short punchy lines THEN a flowing revelation.
- The opening line must INSTANTLY grab attention without asking a question.
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

  // Word budget: 3.6 words per second, ±10 seconds grace
  const minWords = Math.floor((targetDuration - 10) * 3.6);
  const maxWords = Math.floor((targetDuration + 10) * 3.6);

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

const callNativeGeminiPrompt = async (prompt: string): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
  console.log(`[PromptService] Trying Native Google Gemini model: ${modelName}`);
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
    },
  });
  return result.response.text() || '';
};

export const generatePromptDirect = async (user_prompt: string): Promise<string> => {
  try {
    const resultText = await callNativeGeminiPrompt(user_prompt);
    if (!resultText || resultText.trim().split(/\s+/).length < 10) {
      throw new Error('AI returned empty or too-short response.');
    }
    console.log('[PromptService] Successfully generated prompt using native-gemini');
    return resultText.trim();
  } catch (error: any) {
    const message = `Prompt generation failed (native-gemini): ${error?.message || 'unknown error'}`;
    const normalized = String(error?.message || '').toLowerCase();
    const err: any = new Error(message);
    err.statusCode =
      normalized.includes('429') ||
      normalized.includes('too many requests') ||
      normalized.includes('quota') ||
      normalized.includes('rate limit')
        ? 429
        : 502;
    throw err;
  }
};

export const generatePrompt = async (user_prompt: string, options: PromptGenerationOptions = {}): Promise<string> => {
  const fullPrompt = buildPromptWithOptions(user_prompt, options);
  return generatePromptDirect(fullPrompt);
};

// Backward-compatible aliases
export const generateGeminiPrompt = generatePrompt;
export const generateGeminiPromptDirect = generatePromptDirect;
