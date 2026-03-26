export interface TimeoutConfig {
  baseTimeoutMs: number;
  perVideoTimeoutMs: number;
}

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
  return config.baseTimeoutMs + (remainingVideos * config.perVideoTimeoutMs);
}
