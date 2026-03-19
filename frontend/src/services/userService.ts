import api from '../lib/api';

export const userService = {
  async updateSettings(data: {
    emailNotificationsEnabled?: boolean;
    telegramNotificationsEnabled?: boolean;
    pushNotificationsEnabled?: boolean;
  }) {
    const response = await api.put('/user/settings', data);
    return response.data;
  }
};
