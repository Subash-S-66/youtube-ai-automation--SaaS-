import api from '../lib/api';

export const paymentService = {
  async createCheckoutSession(planId?: string) {
    const response = await api.post('/payment/create-checkout', { planId });
    return response.data;
  },
};
