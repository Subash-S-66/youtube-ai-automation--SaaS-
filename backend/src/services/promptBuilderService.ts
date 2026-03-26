import { AppError } from '../middleware/errorHandler';

export interface PromptBuilderInput {
  title?: string | undefined;
  prompt?: string | undefined;
  videoSize?: string | undefined;
  duration?: number | undefined;
  tone?: string | undefined;
  style?: string | undefined;
}

const clean = (value: unknown): string => String(value ?? '').trim();

export const buildStandardPrompt = (input: PromptBuilderInput): string => {
  const normalizedPrompt = clean(input.prompt);
  const normalizedTitle = clean(input.title);

  if (!normalizedPrompt && !normalizedTitle) {
    throw new AppError('At least one of title or prompt is required.', 400);
  }

  const chosenTopic = normalizedPrompt || normalizedTitle;
  const normalizedVideoSize = clean(input.videoSize) || '9:16';
  const normalizedStyle = clean(input.style) || clean(input.tone) || 'viral/engaging';
  const durationLine = typeof input.duration === 'number' && Number.isFinite(input.duration)
    ? `- Total duration: ${Math.max(10, Math.min(180, Math.floor(input.duration)))} seconds`
    : '';

  return [
    `Create a short-form vertical video (${normalizedVideoSize}) for YouTube Shorts.`,
    `Topic: ${chosenTopic}`,
    '',
    'Requirements:',
    '- Hook in first 2 seconds',
    '- Fast-paced engaging script',
    '- Clear, simple sentences',
    '- Optimized for captions',
    durationLine,
    '',
    'Style:',
    `- ${normalizedStyle}`,
    '',
    'Output:',
    '- Structured script in short lines suitable for voiceover and captions.',
  ].filter(Boolean).join('\n');
};
