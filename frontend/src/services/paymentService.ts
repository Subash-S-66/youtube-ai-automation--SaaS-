import api from '../lib/api';

export const paymentService = {
  async createCheckoutSession(planId?: string) {
    const response = await api.post('/payment/create-checkout', { planId });
    return response.data;
  },
  async confirmPayment(data: Record<string, string>) {
    const response = await api.post('/payment/confirm', data);
    return response.data;
  },
  async convertPlan(targetPlan: string) {
    const response = await api.post('/payment/convert', { targetPlan });
    return response.data;
  },
  async renewPlan() {
    const response = await api.post('/payment/renew');
    return response.data;
  },
};
