import api from '../lib/api';

export const promptService = {
  async generatePrompt(user_prompt: string) {
    const response = await api.post('/prompt/generate', { user_prompt });
    return response.data;
  },
};
