import api from '../lib/api';

export const adminService = {
  async getStats() {
    const response = await api.get('/admin/stats');
    return response.data;
  },

  async getUsers() {
    const response = await api.get('/admin/users');
    return response.data;
  },

  async getUserDetails(id: string) {
    const response = await api.get(`/admin/users/${id}`);
    return response.data;
  },

  async updateUserPlan(id: string, data: { plan: string, subscriptionExpiresAt?: string | null }) {
    const response = await api.put(`/admin/users/${id}/plan`, data);
    return response.data;
  },

  async deleteUser(id: string) {
    const response = await api.delete(`/admin/users/${id}`);
    return response.data;
  },

  async createNotification(data: { title: string, message: string, type: string, targetPlans: string[], sendEmail: boolean }) {
    const response = await api.post('/admin/notify', data);
    return response.data;
  },

  async setGlobalBanner(data: { message: string, isActive: boolean, type: string, startAt?: string | null, endAt?: string | null }) {
    const response = await api.post('/admin/banner', data);
    return response.data;
  },

  async getGlobalBanner() {
    const response = await api.get('/admin/banner');
    return response.data;
  },

  async getSystemConfig() {
    const response = await api.get('/admin/config');
    return response.data;
  },

  async updateSystemConfig(data: { betaMode: boolean; planLimits?: { free: number; basic: number; pro: number; premium: number } }) {
    const response = await api.post('/admin/config', data);
    return response.data;
  }
};
