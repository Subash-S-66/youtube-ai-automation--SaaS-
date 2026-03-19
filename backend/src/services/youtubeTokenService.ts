import User from '../models/User';
import { getGoogleOAuthClient } from './youtubeOAuthService';
import { notifyUser } from './notificationService';

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

  // Check if token is present and valid
  // Consider token expired if less than 5 minutes remain
  const isExpired = expiry_date && Date.now() >= expiry_date - 5 * 60 * 1000;

  if (access_token && !isExpired) {
    return access_token;
  }

  if (!refresh_token) {
    // If we reach here, we don't have a valid access token and no refresh token
    user.youtubeChannels.splice(channelIndex, 1);
    user.isYoutubeConnected = user.youtubeChannels.length > 0;
    await user.save();

    await notifyUser(user, 'Action Required: Reconnect YouTube', `⚠️ Your YouTube connection for channel ${channel.channelName} expired. Please reconnect.`).catch(console.error);
    throw new Error('No valid token and no refresh token available');
  }

  try {
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({
      refresh_token: refresh_token,
    });

    const res = await oauth2Client.refreshAccessToken();
    const newTokens = res.credentials;

    const channelToUpdate = user.youtubeChannels[channelIndex];
    if (channelToUpdate) {
      // Update tokens in MongoDB
      channelToUpdate.tokens = {
        access_token: newTokens.access_token || access_token || '', // Keep the old one if it wasn't returned
        refresh_token: newTokens.refresh_token || refresh_token,
        expiry_date: newTokens.expiry_date || undefined,
      };

      user.markModified('youtubeChannels');
      await user.save();

      const access = channelToUpdate.tokens.access_token;
      if (!access) {
          throw new Error('Failed to obtain new access token');
      }

      return access;
    }
    throw new Error('Failed to obtain new access token');
  } catch (error) {
    // If refresh fails (e.g., user revoked access)
    console.error('Failed to refresh YouTube access token:', error);

    user.youtubeChannels.splice(channelIndex, 1);
    user.isYoutubeConnected = user.youtubeChannels.length > 0;
    await user.save();

    await notifyUser(user, 'Action Required: Reconnect YouTube', `⚠️ Your YouTube connection for channel ${channel.channelName} expired. Please reconnect.`).catch(console.error);

    throw new Error('YouTube authentication expired. Please reconnect your account.');
  }
};
