import User from '../models/User';
import { getGoogleOAuthClient } from './youtubeOAuthService';
import { notifyUser } from './notificationService';

const refreshLocks = new Map<string, Promise<string>>();

export const ensureValidYouTubeToken = async (
  accountId: string,
  expectedUserId?: string
): Promise<{ accessToken: string; userId: string; accountId: string }> => {
  const user = expectedUserId
    ? await User.findById(expectedUserId)
    : await User.findOne({ 'youtubeChannels.channelId': accountId });

  if (!user) {
    throw new Error(`YouTube account ${accountId} not found`);
  }

  if (expectedUserId && user._id.toString() !== expectedUserId) {
    throw new Error('YouTube account does not belong to the expected user');
  }

  const accessToken = await getValidYouTubeToken(user._id.toString(), accountId);
  return {
    accessToken,
    userId: user._id.toString(),
    accountId,
  };
};

export const getValidYouTubeToken = async (userId: string, channelId: string): Promise<string> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.isYoutubeConnected || !user.youtubeChannels || user.youtubeChannels.length === 0) {
    throw new Error('User has not connected their YouTube account');
  }

  const channelIndex = user.youtubeChannels.findIndex(c => c.channelId === channelId);
  if (channelIndex === -1) {
    throw new Error(`YouTube channel with ID ${channelId} not found`);
  }

  const channel = user.youtubeChannels[channelIndex];
  if (!channel) {
    throw new Error(`YouTube channel with ID ${channelId} not found`);
  }
  const { access_token, refresh_token, expiry_date } = channel.tokens;

  // Consider token expired if less than 5 minutes remain
  const isExpired = expiry_date && Date.now() >= expiry_date - 5 * 60 * 1000;

  if (access_token && !isExpired) {
    if (channel.isValid === false) {
      channel.isValid = true;
      user.markModified('youtubeChannels');
      await user.save();
    }
    return access_token;
  }

  if (!refresh_token) {
    channel.isValid = false;
    user.markModified('youtubeChannels');
    await user.save();

    await notifyUser(user, 'Action Required: Reconnect YouTube', `âš ï¸ Your YouTube connection for channel ${channel.channelName} expired. Please reconnect.`).catch(console.error);
    throw new Error('No valid token and no refresh token available');
  }

  const lockKey = `${userId}:${channelId}`;
  const existing = refreshLocks.get(lockKey);
  if (existing) {
    return existing;
  }

  const refreshPromise = (async () => {
    try {
      const oauth2Client = getGoogleOAuthClient();
      oauth2Client.setCredentials({
        refresh_token: refresh_token,
      });

      const res = await oauth2Client.refreshAccessToken();
      const newTokens = res.credentials;

      const channelToUpdate = user.youtubeChannels[channelIndex];
      if (!channelToUpdate) {
        throw new Error('Failed to obtain new access token');
      }

      channelToUpdate.tokens = {
        access_token: newTokens.access_token || access_token || '',
        refresh_token: newTokens.refresh_token || refresh_token,
        expiry_date: newTokens.expiry_date || undefined,
      };
      channelToUpdate.isValid = true;

      user.markModified('youtubeChannels');
      await user.save();

      const access = channelToUpdate.tokens.access_token;
      if (!access) {
        throw new Error('Failed to obtain new access token');
      }

      return access;
    } catch (error) {
      console.error('Failed to refresh YouTube access token:', error);
      channel.isValid = false;
      user.markModified('youtubeChannels');
      await user.save();

      await notifyUser(user, 'Action Required: Reconnect YouTube', `âš ï¸ Your YouTube connection for channel ${channel.channelName} expired. Please reconnect.`).catch(console.error);

      throw new Error('YouTube authentication expired. Please reconnect your account.');
    } finally {
      refreshLocks.delete(lockKey);
    }
  })();

  refreshLocks.set(lockKey, refreshPromise);
  return refreshPromise;
};

