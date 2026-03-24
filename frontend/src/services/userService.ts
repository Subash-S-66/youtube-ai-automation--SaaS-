import api from '../lib/api';

export const userService = {
  async updateSettings(data: {
    emailNotificationsEnabled?: boolean;
    telegramNotificationsEnabled?: boolean;
    pushNotificationsEnabled?: boolean;
    templateFont?: string;
    templateColor?: string;
    lastInputMode?: 'topic' | 'prompt';
    lastPrompt?: string;
    lastSelectedTopic?: string;
    lastCustomTopic?: string;
    lastChannelInputs?: Record<string, {
      inputMode?: 'topic' | 'prompt';
      prompt?: string;
      selectedTopic?: string;
      customTopic?: string;
    }>;
  }) {
    const response = await api.put('/user/settings', data);
    return response.data;
  }
};
