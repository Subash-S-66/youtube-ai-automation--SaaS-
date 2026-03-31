import api from '../lib/api';

interface ScheduleVideoConfig {
  promptId: string;
  [key: string]: unknown;
}

export const scheduleService = {
  async createSchedule(data: {
    channelId: string;
    type: 'one-time' | 'interval';
    datetime?: Date;
    intervalHours?: number;
    videosPerInterval?: number;
    cron_expression?: string;
    videoConfig: ScheduleVideoConfig;
  }) {
    const response = await api.post('/schedules', data);
    return response.data;
  },

  async getSchedules(channelId?: string) {
    const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
    const response = await api.get(`/schedules${query}`);
    return response.data;
  },

  async deleteSchedule(id: string) {
    const response = await api.delete(`/schedules/${id}`);
    return response.data;
  },
};
