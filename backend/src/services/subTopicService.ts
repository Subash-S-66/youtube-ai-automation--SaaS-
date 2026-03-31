import { AppError } from '../middleware/errorHandler';
import { generateFromAI } from './aiGenerationService';

const extractJsonArray = (value: string): string[] => {
  const text = String(value || '').trim();
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(); // FIXED: Allow JSON array parsing even when model wraps output in markdown fences.
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

export async function generateSubTopics(
  userTopic: string,
  count: number = 10,
  usedTopics: string[] = []
): Promise<string[]> {
  const normalizedTopic = String(userTopic || '').trim(); // FIXED: Normalize user topic before prompt generation.
  if (!normalizedTopic) {
    throw new AppError('Topic is required for sub-topic generation.', 400); // FIXED: Fail fast for empty input topic.
  }

  const normalizedUsedTopics = usedTopics
    .map((topic) => String(topic || '').trim())
    .filter(Boolean);
  const usedList = normalizedUsedTopics.slice(-50).map((topic) => `- ${topic}`).join('\n'); // FIXED: Limit anti-repeat memory window to recent 50 topics.

  const prompt = `
You are a viral YouTube Shorts strategist.
The user wants to make Shorts about: "${normalizedTopic}"

Generate exactly ${count} DISTINCT, specific, curiosity-driven sub-topics.
Each sub-topic must:
- Be a single, specific angle (not generic)
- Be suitable for a 30-60 second YouTube Short
- Be different from ALL sub-topics in the USED LIST below
- Spark curiosity without using clickbait questions
- Reference real facts, discoveries, or specific technologies

USED LIST (never repeat or paraphrase these):
${usedList || '(none yet)'}

Return ONLY a valid JSON array of strings, no markdown, no explanation:
["sub-topic 1", "sub-topic 2", ..., "sub-topic ${count}"]
`.trim();

  const result = await generateFromAI(prompt);
  const parsed = extractJsonArray(result.text);
  const usedTopicSet = new Set(normalizedUsedTopics.map((topic) => topic.toLowerCase()));
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const topic of parsed) {
    const key = topic.toLowerCase();
    if (!topic || seen.has(key) || usedTopicSet.has(key)) continue; // FIXED: Enforce strict no-repeat filtering against generated and recently used topics.
    seen.add(key);
    deduped.push(topic);
    if (deduped.length >= count) break;
  }

  return deduped;
}
