import api from '../lib/api';

export const scheduleService = {
  async createSchedule(data: {
    channelId: string;
    type: 'one-time' | 'interval';
    datetime?: Date;
    intervalHours?: number;
    videosPerInterval?: number;
    cron_expression?: string;
    videoConfig: any;
  }) {
    const response = await api.post('/schedules', data);
    return response.data;
  },

  async getSchedules() {
    const response = await api.get('/schedules');
    return response.data;
  },

  async deleteSchedule(id: string) {
    const response = await api.delete(`/schedules/${id}`);
    return response.data;
  },
};
