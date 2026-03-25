import api from '../lib/api';

export const youtubeService = {
  async getAuthUrl() {
    // Request an auth URL from the API so we can include the Bearer token.
    const response = await api.get('/youtube/auth-url');
    return response.data?.url as string;
  },

  async disconnect() {
    const response = await api.post('/youtube/disconnect');
    return response.data;
  }
};
