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
  lastPrompt?: string;
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

const buildLineCaptions = (
  scriptLines: string[],
  targetDurationSeconds: number
): Array<{ startMs: number; endMs: number; text: string }> => {
  const lines = scriptLines.filter(Boolean);
  if (lines.length === 0) return [];
  const totalMs = Math.max(15000, Math.min(60000, Math.floor(targetDurationSeconds * 1000)));
  const slot = Math.floor(totalMs / lines.length);
  return lines.map((line, idx) => {
    const startMs = idx * slot;
    const endMs = idx === lines.length - 1 ? totalMs : (idx + 1) * slot;
    return { startMs, endMs, text: line };
  });
};

const buildStructuredScript = (
  scriptLines: string[],
  targetDurationSeconds: number
): Array<{ text: string; duration?: number }> => {
  const lines = scriptLines.filter(Boolean);
  if (lines.length === 0) return [];
  const totalMs = Math.max(15000, Math.min(60000, Math.floor(targetDurationSeconds * 1000)));
  const slotSeconds = Math.max(1, Math.floor((totalMs / lines.length) / 1000));
  return lines.map((line) => ({ text: line, duration: slotSeconds }));
};

const normalizePreparedItem = (raw: any, fallbackTopic: string, targetDurationSeconds: number): PreparedContentItem => {
  const topic = clean(raw?.topic) || fallbackTopic;
  const title = clean(raw?.title).slice(0, 100);
  const description = clean(raw?.description);
  const script = clean(raw?.script);

  const scriptLines = splitScriptLines(script);
  if (!topic || !title || !description || scriptLines.length < 5) {
    throw new AppError('AI content generation returned invalid structure.', 502);
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
    script: scriptLines.slice(0, 5).join('\n'),
    captions: buildLineCaptions(scriptLines.slice(0, 5), targetDurationSeconds),
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
  lastPrompt?: string
): string => {
  const partNote =
    total > 1
      ? `This is video ${index} of ${total} for the same pipeline job. Keep variation high and avoid duplicate hooks.`
      : '';
  const storyNote = storyMode
    ? `Story mode is enabled. Current part: ${currentPart || 1}. Recap enabled: ${!!recapEnabled}. Previous prompt context: ${clean(lastPrompt)}`
    : '';

  return `
You create structured Shorts content as strict JSON only.
Base topic: ${topic}
Prompt context: ${generatedPrompt}
Target duration in seconds: ${durationSeconds}
${partNote}
${storyNote}

Return ONLY JSON with this exact structure:
{
  "topic": "string",
  "title": "string, max 60 chars preferred",
  "hook": "string",
  "description": "string",
  "hashtags": ["#shorts", "..."],
  "script": "exactly 5 lines separated by newline",
  "scenes": ["5 scene phrases"],
  "search_queries": ["5 stock search phrases"]
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
      input.lastPrompt
    );

    try {
      const raw = await generateStructuredContentWithAI(modelPrompt);
      preparedContent.push(normalizePreparedItem(raw, topic, targetDuration));
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
