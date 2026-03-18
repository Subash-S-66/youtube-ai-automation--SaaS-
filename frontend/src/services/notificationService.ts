import api from '../lib/api';

export const notificationService = {
  async saveToken(token: string) {
    try {
      const response = await api.post('/notifications/save-token', { fcmToken: token });
      return response.data;
    } catch (error) {
      console.error('Failed to save FCM token to backend', error);
      throw error;
    }
  }
};
