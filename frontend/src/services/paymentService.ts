import api from '../lib/api';

export const paymentService = {
  async createCheckoutSession() {
    const response = await api.post('/payment/create-checkout');
    return response.data;
  },
};
