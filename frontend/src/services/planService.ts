import api from '../lib/api';

export const planService = {
  async getPlans() {
    const response = await api.get('/admin/plans');
    return response.data;
  },

  async updatePlan(id: string, data: any) {
    const response = await api.put(`/admin/plans/${id}`, data);
    return response.data;
  },
};
