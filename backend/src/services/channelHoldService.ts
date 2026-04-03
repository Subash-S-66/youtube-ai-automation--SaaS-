import User from '../models/User';

const normalizeCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
};

export const resolveJobChannelId = (job: Record<string, any> | null | undefined): string => {
  if (!job || typeof job !== 'object') {
    return '';
  }

  const candidates = [
    job.channelId,
    job.pipelineConfig?.channelId,
    job.youtubeAccountId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = candidate.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return '';
};

export const decrementChannelVideosOnHold = async (
  userId: string,
  channelId: string,
  count: number
): Promise<number> => {
  const normalizedChannelId = String(channelId || '').trim();
  if (!normalizedChannelId) {
    return 0;
  }

  const decrementTarget = normalizeCount(count);

  const userWithChannel = await User.findOne(
    { _id: userId, 'youtubeChannels.channelId': normalizedChannelId },
    { 'youtubeChannels.$': 1 }
  ).lean();

  const currentHold = Number((userWithChannel as any)?.youtubeChannels?.[0]?.videosOnHold || 0);
  const decrementBy = Math.max(0, Math.min(currentHold, decrementTarget));
  if (decrementBy <= 0) {
    return 0;
  }

  await User.updateOne(
    { _id: userId, 'youtubeChannels.channelId': normalizedChannelId },
    { $inc: { 'youtubeChannels.$.videosOnHold': -decrementBy } }
  );

  return decrementBy;
};
