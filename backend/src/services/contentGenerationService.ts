import { AppError } from '../middleware/errorHandler';
import { generateFromAI } from './aiGenerationService';
import { extractTopicValue } from './promptBuilderService';

export interface ContentGenerationInput {
  topic: string;
  prompt: string;
  videoCount: number;
  targetDuration?: number;
  duration?: number;
  storyMode?: boolean;
  currentPart?: number;
  recapEnabled?: boolean;
  ctaEnabled?: boolean;
  lastPrompt?: string;
  templateConfig?: {
    fontStyle?: string;
    subtitleColor?: string;
  };
}

export interface PreparedContentItem {
  topic: string;
  title: string;
  hook: string;
  description: string;
  hashtags: string[];
  script: string;
  captions: Array<{ startMs: number; endMs: number; text: string }>;
  scenes: string[];
  searchQueries: string[];
}

export interface ContentGenerationResult {
  prompt: string;
  script: Array<Array<{ text: string; duration?: number }>>;
  captions: Array<Array<{ startMs: number; endMs: number; text: string }>>;
  title: string;
  description: string;
  hashtags: string[];
  scenes: string[][];
  metadata: Array<{
    title: string;
    description: string;
    hashtags: string[];
    searchQueries: string[];
  }>;
  preparedContent: PreparedContentItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
// ROOT CAUSE FIX: Gemini native audio speaks at ~1.9 WPS (not 3.6).
// Keep a small prompt buffer at 2.0 WPS, with lenient lower-bound validation at 1.6 WPS.
const WORDS_PER_SECOND = 2.0;
const VALIDATION_WPS = 1.6;
const parseEnvMs = (raw: unknown, fallback: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

// Keep a small debounce to avoid immediate back-to-back provider calls after prompt generation.
const PRE_CONTENT_GEN_DELAY_MS = parseEnvMs(process.env.PRE_CONTENT_GEN_DELAY_MS, 250);
const CONTENT_GEN_RETRY_BASE_DELAY_MS = parseEnvMs(process.env.CONTENT_GEN_RETRY_BASE_DELAY_MS, 350);

const clean = (value: unknown): string => String(value ?? '').trim();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getWordBudget = (targetDurationSeconds: number): { minWords: number; maxWords: number } => {
  const target = Math.max(15, Math.min(60, targetDurationSeconds));
  // At ~1.9 WPS, keep a practical acceptance window around target while pipeline performs final control.
  const minWords = Math.max(20, Math.floor((target - 8) * VALIDATION_WPS));
  const maxWords = Math.floor(target * WORDS_PER_SECOND);
  return { minWords, maxWords };
};

const getPromptWordBudget = (targetDurationSeconds: number): { minWords: number; maxWords: number } => {
  const target = Math.max(15, Math.min(60, targetDurationSeconds));
  // Calibrated for Gemini native audio pacing with slight buffer on max words.
  const minWords = Math.floor(Math.max(1, target - 5) * 1.6);
  const maxWords = Math.floor((target + 5) * WORDS_PER_SECOND);
  return { minWords, maxWords };
};

const expandLinesToMinWords = (lines: string[], minWords: number, topic: string): string[] => {
  const output = [...lines];
  const additions = [
    `This shift in ${topic.toLowerCase()} is accelerating faster than most people realize.`,
    'The implications are practical, immediate, and impossible to ignore.',
    'What begins as convenience quickly becomes the default architecture of everyday life.',
  ];
  let idx = 0;
  while (output.join(' ').split(/\s+/).filter(Boolean).length < minWords && idx < 9) {
    output.push(additions[idx % additions.length]!);
    idx++;
  }
  return output;
};

const clipHashtags = (tags: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tagRaw of tags) {
    const tag = clean(tagRaw);
    if (!tag) continue;
    const normalized = tag.startsWith('#') ? tag : `#${tag}`;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= 15) break;
  }
  return out;
};

/** Split on sentence boundaries, preserving full sentences */
const splitIntoLines = (script: string): string[] => {
  const text = String(script || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  // Split after .  !  ?  keeping the punctuation with the sentence
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map(s => s.trim()).filter(Boolean);
};

/** Estimate how long a line takes to speak using configured WPS */
const estimateDuration = (line: string): number => {
  const words = line.split(/\s+/).filter(Boolean).length;
  if (!words) return 1;
  return Math.max(0.5, words / WORDS_PER_SECOND);
};

/** Build per-line captions with real millisecond timestamps */
const buildCaptions = (
  lines: string[],
  targetDurationSeconds: number
): Array<{ startMs: number; endMs: number; text: string }> => {
  if (!lines.length) return [];
  const totalMs = Math.max(10_000, Math.min(65_000, Math.floor(targetDurationSeconds * 1000)));
  const weights = lines.map(l => estimateDuration(l));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let cursor = 0;
  return lines.map((line, idx) => {
    const fraction = weights[idx]! / Math.max(1, totalWeight);
    const durMs = Math.round(fraction * totalMs);
    const startMs = cursor;
    const endMs = idx === lines.length - 1 ? totalMs : Math.min(totalMs, cursor + durMs);
    cursor = endMs;
    return { startMs, endMs, text: line };
  });
};

/** Build structured script objects from lines */
const buildStructuredScript = (
  lines: string[]
): Array<{ text: string; duration?: number }> => {
  return lines.map(line => ({ text: line, duration: estimateDuration(line) }));
};

/** Extract the first JSON object from a model response */
const extractFirstJsonObject = (value: string): any => {
  const text = value.trim();
  // Strip markdown fences
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new AppError('AI response did not contain a JSON object.', 502);
  }
  return JSON.parse(stripped.slice(start, end + 1));
};

// ─────────────────────────────────────────────────────────────────────────────
// THE CORE CONTENT-GENERATION PROMPT
// This is the most important function in the service.
// It produces a single JSON object for one video.
// ─────────────────────────────────────────────────────────────────────────────
const buildContentPrompt = (
  narrationBrief: string,
  topic: string,
  targetDurationSeconds: number,
  index: number,
  total: number,
  storyMode: boolean,
  currentPart: number,
  recapEnabled: boolean,
  ctaEnabled: boolean,
  lastPrompt: string,
): string => {
  const targetDuration = Math.max(15, Math.min(60, targetDurationSeconds));
  const { minWords, maxWords } = getPromptWordBudget(targetDuration);

  // Tightly computed section budgets
  const hookWords = Math.round(minWords * 0.18);                   // ~18% for hook
  const ctaWords = ctaEnabled ? Math.round(minWords * 0.14) : 0;  // ~14% if CTA enabled
  const recapWords = recapEnabled ? Math.round(minWords * 0.12) : 0;
  const mainWords = minWords - hookWords - ctaWords - recapWords;  // rest for main body

  const variationNote = total > 1
    ? `This is video ${index} of ${total} in this batch. Use a DIFFERENT hook and angle from any previous video.`
    : '';

  const storyNote = storyMode
    ? `STORY MODE Part ${currentPart}: ${currentPart > 1 && lastPrompt ? `Continue from: "${lastPrompt.slice(0, 120)}"` : 'Open the story arc.'} Frame as an ongoing series.`
    : '';

  return `You are a premium YouTube Shorts director creating CINEMATIC, viral short-form content. Return ONLY valid JSON — no markdown, no extra text.

NARRATION BRIEF (this IS what the video is about — follow it exactly):
"${narrationBrief}"

TOPIC: ${topic}
TARGET DURATION: ${targetDuration} seconds
TOTAL WORD BUDGET: ${minWords}–${maxWords} words (the entire script must stay in this range)

SECTION BREAKDOWN (every section's words add up to the total budget):
• Hook (first line): ~${hookWords} words — a BOLD STATEMENT, dramatic fact, or cinematic scene-setter. NEVER a question.
• Main body: ~${mainWords} words — deliver the revelation like a documentary narrator. Vivid, confident, authoritative.
${recapEnabled ? `• Recap (second-to-last): ~${recapWords} words — one sentence crystallising the key insight.` : '• NO recap section.'}
${ctaEnabled ? `• CTA (last line): ~${ctaWords} words — a direct action call (follow, subscribe, save, share, etc.).` : '• NO call-to-action. End with a powerful, memorable closing statement that lingers.'}

${variationNote}
${storyNote}

HOOK RULES (first line of script — most important):
1. MUST open with one of these patterns:
  - A jaw-dropping statistic: "In 2024, [specific number] revealed something unexpected."
  - A named discovery: "The [specific named technology] just proved scientists wrong."
  - A dramatic reversal: "Everything we thought about [topic] changed in [year]."
  - A direct challenge: "Most people still don't know [specific fact] about [topic]."
2. BANNED starters: "Did you know", "What if", "Have you ever", "Here are", "In this video", "Today we", "Welcome back", "Want to know", "Let me tell you".
3. Max 15 words for the hook line.
4. Hook must make the viewer feel they are missing critical information.

CONTENT QUALITY RULES:
1. Write as a confident documentary narrator, not a YouTuber.
2. Every sentence must contain ONE specific, verifiable fact or detail.
3. Avoid filler: "amazing", "incredible", "mind-blowing", "you won't believe".
4. Use active voice. Replace all instances of "things" with specific nouns.
5. Each sentence: maximum 15 words.
6. The script must tell a micro-story with: hook -> context -> revelation -> impact.
7. End WITHOUT a question. End with a powerful declarative statement or call to action.
8. NO labels in the script (no "Hook:", "CTA:", "Main:", "Recap:").
9. Count words: total script must be ${minWords}–${maxWords} words. Expand main body if under. Trim if over.

SCENE RULES (cinematic quality):
- Generate exactly one scene per script line (minimum 5, maximum 12 scenes total).
- Each scene is a CINEMATIC shot description, 5–10 words, describing what the camera sees.
  GREAT: "close-up scientist hands adjusting glowing microscope lens"
  GREAT: "aerial drone shot of solar panel farm at golden hour"
  GREAT: "extreme macro of water droplet hitting liquid surface slow motion"
  BAD: "technology innovation" (too vague)
  BAD: "person talking about science" (generic)
- Every scene must feel like a shot from a high-budget documentary or film.
- Scenes must visually MATCH what is being SAID on that line.

TITLE RULES:
- Max 60 characters. Make it a STATEMENT, not a question.
- Good: "This 3-Second Trick Outperforms Billion-Dollar Tech"
- Bad: "Did You Know About This Amazing Tech?"

HASHTAG RULES:
- 10–15 hashtags, all lowercase with #
- Must include #shorts
- Mix broad (#science) and niche-specific (#quantumphysics) tags

OUTPUT — return exactly this JSON structure (no other keys):
{
  "topic": "string — the video topic, max 80 chars",
  "title": "string — YouTube title, max 60 chars, STATEMENT-based, includes key subject",
  "hook": "string — the first line of the script (copied from script[0])",
  "description": "string — 2-3 SEO sentences about the video, factually accurate, compelling",
  "hashtags": ["#shorts", "..."],
  "script": "string — ALL lines joined by newlines, one sentence per line, total ${minWords}–${maxWords} words",
  "scenes": ["cinematic shot description 1", "cinematic shot description 2", "..."],
  "search_queries": ["specific visual search query 1", "specific visual search query 2", "..."]
}

The "scenes" and "search_queries" arrays must have the SAME number of items as there are lines in "script".
Double-check: count the words in "script". It MUST be ${minWords}–${maxWords} words.`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Validate and normalise one AI-returned content item
// ─────────────────────────────────────────────────────────────────────────────
const normalizeContentItem = (
  raw: any,
  fallbackTopic: string,
  targetDurationSeconds: number
): PreparedContentItem => {
  const topic = clean(raw?.topic) || fallbackTopic;
  const title = clean(raw?.title).slice(0, 100);
  const description = clean(raw?.description);
  const rawScript = clean(raw?.script);
  const { minWords, maxWords } = getWordBudget(targetDurationSeconds);

  if (!topic || !title || !description) {
    throw new AppError('AI content missing required fields (topic/title/description).', 502);
  }

  if (!rawScript) {
    throw new AppError('AI content returned empty script.', 502);
  }

  let lines = splitIntoLines(rawScript).filter(l => l.length > 0);
  if (lines.length < 2) {
    throw new AppError(`Script has too few lines (${lines.length}). Expected at least 2.`, 502);
  }

  let wordCount = lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (wordCount < minWords) {
    lines = expandLinesToMinWords(lines, minWords, topic);
    wordCount = lines.join(' ').split(/\s+/).filter(Boolean).length;
  }
  // Keep a stronger practical floor for 60s jobs so pipeline doesn't start from 30-40s scripts.
  const runtimeFloor = Math.floor((Math.max(15, Math.min(60, targetDurationSeconds)) - 5) * 3.0);
  if (wordCount < runtimeFloor) {
    lines = expandLinesToMinWords(lines, runtimeFloor, topic);
    wordCount = lines.join(' ').split(/\s+/).filter(Boolean).length;
  }
  if (wordCount > maxWords + 20) {
    // Soft over-budget — trim lines from the end until within budget
    let trimmedLines = [...lines];
    while (trimmedLines.join(' ').split(/\s+/).length > maxWords && trimmedLines.length > 2) {
      trimmedLines.pop();
    }
    lines.splice(0, lines.length, ...trimmedLines);
  }

  const hook = clean(raw?.hook) || lines[0] || '';
  const scenesRaw = Array.isArray(raw?.scenes) ? raw.scenes : [];
  const searchQueriesRaw = Array.isArray(raw?.search_queries)
    ? raw.search_queries
    : Array.isArray(raw?.searchQueries)
      ? raw.searchQueries
      : [];
  const hashtagsRaw = Array.isArray(raw?.hashtags) ? raw.hashtags : [];

  const scenes = scenesRaw.map((x: any) => clean(x)).filter(Boolean);
  const searchQueries = searchQueriesRaw.map((x: any) => clean(x)).filter(Boolean);
  const hashtags = clipHashtags(hashtagsRaw.map((x: any) => clean(x)));

  if (scenes.length < 3) {
    throw new AppError(`Scenes too few (${scenes.length}), need at least 3.`, 502);
  }
  if (hashtags.length === 0) {
    throw new AppError('AI returned no hashtags.', 502);
  }

  const finalScript = lines.join('\n');

  return {
    topic,
    title,
    hook,
    description,
    hashtags,
    script: finalScript,
    captions: buildCaptions(lines, targetDurationSeconds),
    scenes: scenes.slice(0, Math.max(5, lines.length)),
    searchQueries: searchQueries.slice(0, Math.max(5, lines.length)),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Retry wrapper
// ─────────────────────────────────────────────────────────────────────────────
const generateWithRetry = async (
  modelPrompt: string,
  topic: string,
  targetDurationSeconds: number
): Promise<PreparedContentItem> => {
  const MAX_RETRIES = 3;
  let lastError: unknown = null;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const aiResult = await generateFromAI(modelPrompt);
      const output = clean(aiResult.text);
      if (!output) throw new AppError('Empty response from AI.', 502);
      const raw = extractFirstJsonObject(output);
      return normalizeContentItem(raw, topic, targetDurationSeconds);
    } catch (err) {
      lastError = err;
      if (i < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, CONTENT_GEN_RETRY_BASE_DELAY_MS * (i + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Content generation retries exhausted.');
};

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fallback (when AI fails completely)
// ─────────────────────────────────────────────────────────────────────────────
const deterministicFallback = (
  topic: string,
  narrationBrief: string,
  targetDurationSeconds: number
): PreparedContentItem => {
  const safeTopic = clean(topic) || 'This Topic';
  const briefSentence = (narrationBrief.split('.')[0] || safeTopic).trim();
  const lines = [
    `${briefSentence}.`,
    `Most people have never heard about this.`,
    `The evidence behind it is staggering.`,
    `Once you understand, you cannot unsee it.`,
    `Save this before it disappears from your feed.`,
  ];
  return {
    topic: safeTopic,
    title: `${safeTopic} — The Truth Revealed`.slice(0, 60),
    hook: lines[0]!,
    description: `A deep dive into ${safeTopic} that changes how you see the world.`,
    hashtags: ['#shorts', '#facts', '#mindblown', '#viral', '#education', '#science', '#documentary'],
    script: lines.join('\n'),
    captions: buildCaptions(lines, targetDurationSeconds),
    scenes: [
      `cinematic close-up revealing ${safeTopic.toLowerCase().slice(0, 30)} detail`,
      'dramatic slow motion reveal of hidden detail',
      'aerial drone shot of dramatic landscape at golden hour',
      'extreme close-up of eye reflecting light in wonder',
      'hand reaching toward glowing screen saving content',
    ],
    searchQueries: [
      `cinematic ${safeTopic.toLowerCase().slice(0, 20)} close up`,
      'dramatic slow motion reveal cinematic',
      'aerial drone dramatic landscape golden hour',
      'eye close up reflecting light wonder',
      'hand saving content on phone screen',
    ],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export const generateContent = async (input: ContentGenerationInput): Promise<ContentGenerationResult> => {
  const topic = extractTopicValue(input.topic);
  if (!topic) {
    throw new AppError('Topic is required for content generation.', 400);
  }

  const count = Math.max(1, Number(input.videoCount || 1));
  const targetDuration = Math.max(15, Math.min(60, Number(input.targetDuration || input.duration || 40)));
  const narrationBrief = clean(input.prompt);

  if (!narrationBrief) {
    throw new AppError('A narration brief is required before content generation.', 400);
  }

  const preparedContent: PreparedContentItem[] = [];

  // Guard against immediate back-to-back Gemini calls:
  // frontend prompt generation often happens right before content generation.
  await sleep(PRE_CONTENT_GEN_DELAY_MS);

  for (let i = 1; i <= count; i++) {
    const modelPrompt = buildContentPrompt(
      narrationBrief,
      topic,
      targetDuration,
      i,
      count,
      !!input.storyMode,
      input.currentPart || 1,
      !!input.recapEnabled,
      !!input.ctaEnabled,
      input.lastPrompt || ''
    );

    try {
      preparedContent.push(await generateWithRetry(modelPrompt, topic, targetDuration));
    } catch (error) {
      // TODO: Re-enable deterministic fallback later
      // console.error(`[ContentGen] Video ${i}/${count} failed, using fallback:`, error);
      // preparedContent.push(deterministicFallback(topic, narrationBrief, targetDuration));
      throw error;
    }
  }

  const first = preparedContent[0]!;

  return {
    prompt: narrationBrief,
    script: preparedContent.map(item =>
      buildStructuredScript(splitIntoLines(item.script))
    ),
    captions: preparedContent.map(item => item.captions),
    title: first.title,
    description: first.description,
    hashtags: first.hashtags,
    scenes: preparedContent.map(item => item.scenes),
    metadata: preparedContent.map(item => ({
      title: item.title,
      description: item.description,
      hashtags: item.hashtags,
      searchQueries: item.searchQueries,
    })),
    preparedContent,
  };
};
