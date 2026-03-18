import api from '../lib/api';

export const youtubeService = {
  getAuthUrl() {
    // We direct the user browser straight to the API route to trigger OAuth consent flow
    return `${api.defaults.baseURL}/youtube/auth`;
  },

  async disconnect() {
    const response = await api.post('/youtube/disconnect');
    return response.data;
  }
};
