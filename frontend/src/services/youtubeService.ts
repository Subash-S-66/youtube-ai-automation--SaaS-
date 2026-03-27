import api from '../lib/api';

export const youtubeService = {
  async getAuthUrl(reconnectChannelId?: string) {
    // Request an auth URL from the API so we can include the Bearer token.
    const query = reconnectChannelId ? `?reconnectChannelId=${encodeURIComponent(reconnectChannelId)}` : '';
    const response = await api.get(`/youtube/auth-url${query}`);
    return response.data?.url as string;
  },

  async disconnect() {
    const response = await api.post('/youtube/disconnect');
    return response.data;
  }
};
