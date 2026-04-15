export const DEFAULT_FFMPEG_COMMAND_TIMEOUT_SECONDS = 360;
export const MIN_FFMPEG_COMMAND_TIMEOUT_SECONDS = 30;
export const MAX_FFMPEG_COMMAND_TIMEOUT_SECONDS = 7200;

export const DEFAULT_COMPOSITION_HEARTBEAT_SECONDS = 30;
export const MIN_COMPOSITION_HEARTBEAT_SECONDS = 5;
export const MAX_COMPOSITION_HEARTBEAT_SECONDS = 600;

export const MIN_PIPELINE_EXECUTION_TIMEOUT_MINUTES = 0.5;
export const MAX_PIPELINE_EXECUTION_TIMEOUT_MINUTES = 240;
export const DEFAULT_PIPELINE_EXECUTION_TIMEOUT_MINUTES = 15;

const LEGACY_PIPELINE_TIMEOUT_BASE_MINUTES = 10;
const LEGACY_PIPELINE_TIMEOUT_PER_VIDEO_MINUTES = 5;

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const roundToSingleDecimal = (value: number): number => {
  return Math.round(value * 10) / 10;
};

export const sanitizeFfmpegCommandTimeoutSeconds = (value: unknown): number => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed <= 0) {
    return DEFAULT_FFMPEG_COMMAND_TIMEOUT_SECONDS;
  }
  return Math.floor(clamp(parsed, MIN_FFMPEG_COMMAND_TIMEOUT_SECONDS, MAX_FFMPEG_COMMAND_TIMEOUT_SECONDS));
};

export const sanitizeCompositionHeartbeatSeconds = (value: unknown): number => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed <= 0) {
    return DEFAULT_COMPOSITION_HEARTBEAT_SECONDS;
  }
  return Math.floor(clamp(parsed, MIN_COMPOSITION_HEARTBEAT_SECONDS, MAX_COMPOSITION_HEARTBEAT_SECONDS));
};

export const sanitizePipelineExecutionTimeoutMinutes = (value: unknown): number | null => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed <= 0) {
    return null;
  }
  return roundToSingleDecimal(
    clamp(parsed, MIN_PIPELINE_EXECUTION_TIMEOUT_MINUTES, MAX_PIPELINE_EXECUTION_TIMEOUT_MINUTES)
  );
};

export const resolveDefaultPipelineExecutionTimeoutMinutes = (): number => {
  const envCandidates = [
    process.env.PIPELINE_EXECUTION_TIMEOUT_MINUTES,
    process.env.PIPELINE_EXECUTION_TIMEOUT_DEFAULT_MINUTES,
  ];

  for (const candidate of envCandidates) {
    const normalized = sanitizePipelineExecutionTimeoutMinutes(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }

  return DEFAULT_PIPELINE_EXECUTION_TIMEOUT_MINUTES;
};

export const getLegacyPipelineExecutionTimeoutMinutes = (videoCount: unknown): number => {
  const count = Math.max(1, Math.floor(Number(videoCount) || 1));
  return LEGACY_PIPELINE_TIMEOUT_BASE_MINUTES + (count - 1) * LEGACY_PIPELINE_TIMEOUT_PER_VIDEO_MINUTES;
};

export const resolvePipelineExecutionTimeoutMinutes = (
  configuredTimeoutMinutes: unknown,
  videoCount: unknown
): number => {
  const configured = sanitizePipelineExecutionTimeoutMinutes(configuredTimeoutMinutes);
  if (configured !== null) {
    return configured;
  }

  const defaultConfigured = resolveDefaultPipelineExecutionTimeoutMinutes();
  const legacyDerived = getLegacyPipelineExecutionTimeoutMinutes(videoCount);
  return Math.max(defaultConfigured, legacyDerived);
};

export const resolvePipelineExecutionTimeoutMs = (
  configuredTimeoutMinutes: unknown,
  videoCount: unknown
): number => {
  const minutes = resolvePipelineExecutionTimeoutMinutes(configuredTimeoutMinutes, videoCount);
  return Math.max(30_000, Math.floor(minutes * 60 * 1000));
};
