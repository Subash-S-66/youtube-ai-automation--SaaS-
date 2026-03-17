import User from '../models/User';
import { getGoogleOAuthClient } from './youtubeOAuthService';
import { notifyUser } from './notificationService';

export const getValidYouTubeToken = async (userId: string): Promise<string> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.isYoutubeConnected || !user.youtubeTokens) {
    throw new Error('User has not connected their YouTube account');
  }

  const { access_token, refresh_token, expiry_date } = user.youtubeTokens;

  // Check if token is present and valid
  // Consider token expired if less than 5 minutes remain
  const isExpired = expiry_date && Date.now() >= expiry_date - 5 * 60 * 1000;

  if (access_token && !isExpired) {
    return access_token;
  }

  if (!refresh_token) {
    // If we reach here, we don't have a valid access token and no refresh token
    user.isYoutubeConnected = false;
    user.set('youtubeTokens', undefined);
    await user.save();
    throw new Error('No valid token and no refresh token available');
  }

  try {
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({
      refresh_token: refresh_token,
    });

    const res = await oauth2Client.refreshAccessToken();
    const newTokens = res.credentials;

    // Update tokens in MongoDB
    user.set('youtubeTokens', {
      access_token: newTokens.access_token || access_token || '', // Keep the old one if it wasn't returned
      refresh_token: newTokens.refresh_token || refresh_token,
      expiry_date: newTokens.expiry_date || undefined,
    });

    await user.save();

    const access = user.youtubeTokens?.access_token;
    if (!access) {
        throw new Error('Failed to obtain new access token');
    }

    return access;
  } catch (error) {
    // If refresh fails (e.g., user revoked access)
    console.error('Failed to refresh YouTube access token:', error);

    // Revoke access on our end
    user.isYoutubeConnected = false;
    user.set('youtubeTokens', undefined);
    await user.save();

    // Notify user of token expiry
    await notifyUser(user, 'Action Required: Reconnect YouTube', '⚠️ Your YouTube connection expired. Please reconnect.');

    throw new Error('YouTube authentication expired. Please reconnect your account.');
  }
};
