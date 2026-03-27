import { AppError } from '../middleware/errorHandler';
import { generateFromAI } from './aiGenerationService';

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

const clean = (value: unknown): string => String(value ?? '').trim();

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

const splitScriptLines = (script: string): string[] => {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const splitSentences = (text: string): string[] => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const trimScriptToMaxWords = (script: string, maxWords: number): string => {
  const sentences = splitSentences(script);
  if (!sentences.length) return String(script || '').trim();

  const selected: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    const count = sentence.split(/\s+/).filter(Boolean).length;
    if (words + count > maxWords) break;
    selected.push(sentence);
    words += count;
  }

  if (!selected.length) {
    const clipped = String(script || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, Math.max(1, maxWords))
      .join(' ')
      .trim();
    return clipped.endsWith('.') || clipped.endsWith('!') || clipped.endsWith('?')
      ? clipped
      : `${clipped}.`;
  }

  return selected.join('\n').trim();
};

const WORDS_PER_SECOND = 2.5;

const estimateLineDuration = (line: string): number => {
  const words = String(line || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (!words) return 1;
  return Math.max(1, Number((words / WORDS_PER_SECOND).toFixed(2)));
};

const estimateScriptDuration = (lines: string[]): number => {
  return Number(lines.reduce((sum, line) => sum + estimateLineDuration(line), 0).toFixed(2));
};

const ensureDurationBounds = (lines: string[], targetDurationSeconds: number): string[] => {
  const safe = lines.filter(Boolean);
  if (!safe.length) return safe;

  let current = estimateScriptDuration(safe);
  const target = Math.max(15, Math.min(60, targetDurationSeconds));

  while (current > target + 0.5 && safe.length > 1) {
    safe.pop();
    current = estimateScriptDuration(safe);
  }

  const filler = 'This is the key detail that completes the explanation.';
  while (current < target - 0.5) {
    safe.push(filler);
    current = estimateScriptDuration(safe);
    if (safe.length > 20) break;
  }

  return safe;
};

const buildLineCaptions = (
  scriptLines: string[],
  targetDurationSeconds: number
): Array<{ startMs: number; endMs: number; text: string }> => {
  const lines = scriptLines.filter(Boolean);
  if (lines.length === 0) return [];
  const totalMs = Math.max(15000, Math.min(60000, Math.floor(targetDurationSeconds * 1000)));
  const totalWords = lines.reduce((sum, line) => sum + line.split(/\s+/).filter(Boolean).length, 0);
  let cursor = 0;
  return lines.map((line, idx) => {
    const lineWords = line.split(/\s+/).filter(Boolean).length;
    const lineFrac = lineWords / Math.max(1, totalWords);
    const lineDurMs = Math.round(lineFrac * totalMs);
    const startMs = cursor;
    const endMs = idx === lines.length - 1 ? totalMs : cursor + lineDurMs;
    cursor = endMs;
    return { startMs, endMs, text: line };
  });
};

const buildStructuredScript = (
  scriptLines: string[],
  targetDurationSeconds: number
): Array<{ text: string; duration?: number }> => {
  const lines = ensureDurationBounds(scriptLines.filter(Boolean), targetDurationSeconds);
  if (lines.length === 0) return [];
  return lines.map((line) => ({ text: line, duration: estimateLineDuration(line) }));
};

const normalizePreparedItem = (raw: any, fallbackTopic: string, targetDurationSeconds: number): PreparedContentItem => {
  const topic = clean(raw?.topic) || fallbackTopic;
  const title = clean(raw?.title).slice(0, 100);
  const description = clean(raw?.description);
  const rawScript = clean(raw?.script);
  const minWords = Math.floor((targetDurationSeconds - 5) * 2.5);
  const maxWords = Math.floor(Math.min(60, targetDurationSeconds + 5) * 2.5);
  const cappedScript = trimScriptToMaxWords(rawScript, maxWords);
  const scriptLines = splitScriptLines(cappedScript);
  const minLines = 3;
  if (!topic || !title || !description || scriptLines.length < minLines) {
    throw new AppError('AI content generation returned invalid structure.', 502);
  }
  const wordCount = scriptLines.join(' ').split(/\s+/).filter(Boolean).length;
  if (wordCount < minWords) {
    throw new AppError(
      `Script too short: ${wordCount} words for ${targetDurationSeconds}s target.`,
      502
    );
  }

  const hook = clean(raw?.hook) || scriptLines[0] || '';
  const scenesRaw = Array.isArray(raw?.scenes) ? raw.scenes : [];
  const searchQueriesRaw = Array.isArray(raw?.search_queries) ? raw.search_queries : (Array.isArray(raw?.searchQueries) ? raw.searchQueries : []);
  const hashtagsRaw = Array.isArray(raw?.hashtags) ? raw.hashtags : [];

  const scenes = scenesRaw.map((x: any) => clean(x)).filter(Boolean).slice(0, 5);
  const searchQueries = searchQueriesRaw.map((x: any) => clean(x)).filter(Boolean).slice(0, 5);
  const hashtags = clipHashtags(hashtagsRaw.map((x: any) => clean(x)));

  if (scenes.length < 5 || searchQueries.length < 5 || hashtags.length === 0) {
    throw new AppError('AI content generation returned incomplete scenes/search/hashtags.', 502);
  }

  return {
    topic,
    title,
    hook,
    description,
    hashtags,
    script: scriptLines.join('\n'),
    captions: buildLineCaptions(scriptLines, targetDurationSeconds),
    scenes,
    searchQueries,
  };
};

const buildStructuredPrompt = (
  generatedPrompt: string,
  topic: string,
  durationSeconds: number,
  index: number,
  total: number,
  storyMode: boolean,
  currentPart?: number,
  recapEnabled?: boolean,
  lastPrompt?: string,
  ctaEnabled?: boolean,
  templateConfig?: { fontStyle?: string; subtitleColor?: string }
): string => {
  const partNote =
    total > 1
      ? `This is video ${index} of ${total} for the same pipeline job. Keep variation high and avoid duplicate hooks.`
      : '';
  const storyNote = storyMode
    ? `Story mode is enabled. Current part: ${currentPart || 1}. Recap enabled: ${!!recapEnabled}. Previous prompt context: ${clean(lastPrompt)}`
    : '';
  const ctaNote = ctaEnabled
    ? `CTA: Include a 1-2 sentence call-to-action at the END of the script. CTA counts toward word budget.`
    : `CTA: Do NOT include a call-to-action.`;
  const recapNote = recapEnabled
    ? `RECAP: Include a 1 sentence recap of the main point BEFORE the CTA. Recap counts toward word budget.`
    : `RECAP: Do NOT include a recap section.`;
  const minWords = Math.floor((durationSeconds - 5) * 2.5);
  const maxWords = Math.floor(Math.min(60, durationSeconds + 5) * 2.5);
  return `
Create a YouTube Shorts script for the topic below.

Topic / Prompt: ${generatedPrompt}
Target duration: ${durationSeconds} seconds
Word count: ${minWords}-${maxWords} words TOTAL (including CTA and recap if present)

${ctaNote}
${recapNote}
${storyNote}
${partNote}

RULES:
- The script must be ${minWords}-${maxWords} words. Count every word.
- Write in clear, punchy sentences. No filler.
- First sentence must be a strong hook (curiosity/surprise/question).
- Use natural line breaks between sentences.
- Do NOT add section labels like "Hook:", "CTA:", "Main:".
- Return ONLY JSON matching this exact schema:
{
  "topic": "string",
  "title": "string (max 60 chars)",
  "hook": "string (first sentence)",
  "description": "string (2-3 SEO sentences)",
  "hashtags": ["#shorts", "..."],
  "script": "full script as newline-separated lines",
  "scenes": ["5 stock video search phrases"],
  "search_queries": ["5 stock video search queries"]
}
`.trim();
};

const extractFirstJsonObject = (value: string): any => {
  const text = value.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new AppError('AI response did not contain JSON content.', 502);
  }
  return JSON.parse(text.slice(start, end + 1));
};

const generateStructuredContentWithAI = async (prompt: string): Promise<any> => {
  const aiResult = await generateFromAI(prompt);
  const output = clean(aiResult.text);
  if (!output) {
    throw new AppError('Empty response from content generation model.', 502);
  }
  return extractFirstJsonObject(output);
};

const generateWithRetry = async (
  modelPrompt: string,
  topic: string,
  targetDurationSeconds: number
): Promise<PreparedContentItem> => {
  const MAX_RETRIES = 3;
  const minWords = Math.floor((targetDurationSeconds - 5) * 2.5);
  const maxWords = Math.floor(Math.min(60, targetDurationSeconds + 5) * 2.5);
  let lastError: unknown = null;
  for (let i = 0; i < MAX_RETRIES; i += 1) {
    try {
      const raw = await generateStructuredContentWithAI(modelPrompt);
      const result = normalizePreparedItem(raw, topic, targetDurationSeconds);
      const words = result.script.split(/\s+/).filter(Boolean).length;
      if (words < minWords) {
        throw new Error(`Script too short: ${words} < ${minWords}`);
      }
      if (words > maxWords) {
        throw new Error(`Script too long: ${words} > ${maxWords}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (i === MAX_RETRIES - 1) {
        throw err;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Content generation retries exhausted.');
};

const deterministicFallback = (
  topic: string,
  generatedPrompt: string,
  index: number
): PreparedContentItem => {
  const safeTopic = clean(topic) || 'Untitled Topic';
  const safePrompt = clean(generatedPrompt) || safeTopic;
  const title = `${safeTopic} #${index}`.slice(0, 60);
  const lines = [
    `What if this changes everything about ${safeTopic}?`,
    `Here is the setup: ${safePrompt.slice(0, 120)}.`,
    `Most people miss this key detail when they discuss ${safeTopic}.`,
    `The twist is that one small decision changes the outcome fast.`,
    `Follow for the next short on ${safeTopic}.`,
  ];
  return {
    topic: safeTopic,
    title,
    hook: lines[0] || '',
    description: `Quick breakdown of ${safeTopic}.`,
    hashtags: ['#shorts', '#viral', '#youtube'],
    script: lines.join('\n'),
    captions: buildLineCaptions(lines, 40),
    scenes: ['opening scene', 'context scene', 'detail scene', 'twist scene', 'cta scene'],
    searchQueries: ['intro', 'context', 'detail', 'twist', 'call to action'],
  };
};

export const generateContent = async (input: ContentGenerationInput): Promise<ContentGenerationResult> => {
  const topic = clean(input.topic);
  if (!topic) {
    throw new AppError('Topic is required for content generation.', 400);
  }

  const count = Math.max(1, Number(input.videoCount || 1));
  const targetDuration = Math.max(15, Math.min(60, Number(input.targetDuration || input.duration || 40)));
  const generatedPrompt = clean(input.prompt);
  if (!generatedPrompt) {
    throw new AppError('A standardized prompt is required before content generation.', 400);
  }

  const preparedContent: PreparedContentItem[] = [];

  for (let i = 1; i <= count; i += 1) {
    const modelPrompt = buildStructuredPrompt(
      generatedPrompt,
      topic,
      targetDuration,
      i,
      count,
      !!input.storyMode,
      input.currentPart,
      input.recapEnabled,
      input.lastPrompt,
      input.ctaEnabled,
      input.templateConfig
    );

    try {
      preparedContent.push(await generateWithRetry(modelPrompt, topic, targetDuration));
    } catch (error) {
      // deterministic fallback keeps the pipeline executable when model response is malformed
      preparedContent.push(deterministicFallback(topic, generatedPrompt, i));
    }
  }

  const first = preparedContent[0];

  return {
    prompt: generatedPrompt,
    script: preparedContent.map((item) =>
      buildStructuredScript(splitScriptLines(item.script), targetDuration)
    ),
    captions: preparedContent.map((item) => item.captions),
    title: first?.title || '',
    description: first?.description || '',
    hashtags: first?.hashtags || [],
    scenes: preparedContent.map((item) => item.scenes),
    metadata: preparedContent.map((item) => ({
      title: item.title,
      description: item.description,
      hashtags: item.hashtags,
      searchQueries: item.searchQueries,
    })),
    preparedContent,
  };
};
