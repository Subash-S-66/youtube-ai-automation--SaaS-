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
  }
};
