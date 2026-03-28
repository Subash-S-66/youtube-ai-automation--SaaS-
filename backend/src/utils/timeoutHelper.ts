export interface TimeoutConfig {
  baseTimeoutMs: number;
  perVideoTimeoutMs: number;
}

const MIN_JOB_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes floor for full pipeline runs
const MAX_JOB_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours safety cap

/**
 * Dynamically calculates the timeout for a job based on the number of videos.
 *
 * @param videoCount - The total number of videos in the job
 * @param config - The system timeout configuration containing base and per-video times
 * @param processedVideos - (Optional) The number of videos already processed, for progress-aware calculation
 * @returns The calculated timeout in milliseconds
 */
export function calculateJobTimeout(
  videoCount: number,
  config: TimeoutConfig,
  processedVideos: number = 0
): number {
  const remainingVideos = Math.max(0, videoCount - processedVideos);

  // Phase 7 optimization incorporated directly: if processedVideos > 0, we can use a tighter timeout bound for the remainder
  // The buffer is handled by the baseTimeoutMs, or we can use the baseTimeout directly.
  // Let's stick to the formula from instructions: baseTimeoutMs + (remainingVideos * perVideoTimeoutMs)
  const computed = config.baseTimeoutMs + (remainingVideos * config.perVideoTimeoutMs);
  return Math.max(MIN_JOB_TIMEOUT_MS, Math.min(MAX_JOB_TIMEOUT_MS, computed));
}
