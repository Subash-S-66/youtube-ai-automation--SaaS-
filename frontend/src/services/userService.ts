import api from '../lib/api';

export const userService = {
  async updateSettings(data: {
    emailNotificationsEnabled?: boolean;
    telegramNotificationsEnabled?: boolean;
    pushNotificationsEnabled?: boolean;
    templateFont?: string;
    templateColor?: string;
    lastInputMode?: 'topic' | 'prompt';
    lastSelectedChannelId?: string;
    lastPrompt?: string;
    lastSelectedTopic?: string;
    lastCustomTopic?: string;
    lastChannelInputs?: Record<string, {
      inputMode?: 'topic' | 'prompt';
      prompt?: string;
      selectedTopic?: string;
      customTopic?: string;
      storyMode?: boolean;
      storyId?: string;
      currentPart?: number;
      storyContext?: string;
      recapEnabled?: boolean;
      ctaEnabled?: boolean;
      duration?: number;
      contentType?: 'clips' | 'images' | 'mixed';
      videoCount?: number;
      selectedVoices?: string[];
      randomVoice?: boolean;
      templateFont?: string;
      templateColor?: string;
      captionPosition?: 'top' | 'middle' | 'bottom';
      captionAnimation?: 'fade' | 'slide_left' | 'slide_right' | 'pop' | 'none';
      maxWordsPerCaption?: number;
      useCustomMedia?: boolean;
      selectedThumbnailId?: string;
      scheduleEnabled?: boolean;
      scheduleDatetime?: string;
      autoUploadEnabled?: boolean;
      autoUploadIntervalHours?: number;
      autoUploadVideosPerInterval?: number;
    }>;
  }) {
    const response = await api.put('/user/settings', data);
    return response.data;
  }
};
