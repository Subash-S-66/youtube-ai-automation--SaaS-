import api from '../lib/api';

export const authService = {
  async register(data: any) {
    const response = await api.post('/auth/register', data);
    return response.data;
  },

  async login(data: any) {
    const response = await api.post('/auth/login', data);
    return response.data;
  },

  async adminLogin(data: any) {
    const response = await api.post('/auth/admin-login', data);
    return response.data;
  },

  async getMe() {
    const response = await api.get('/auth/me');
    return response.data;
  },

  logout() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
  },

  handleAuthError(err: any) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      this.logout();
    }
  },

  async verifyEmail(token: string, redirect?: string) {
    let url = `/auth/verify-email?token=${token}`;
    if (redirect) {
      url += `&redirect=${encodeURIComponent(redirect)}`;
    }
    const response = await api.get(url);
    return response.data;
  },

  async resendVerification(email: string) {
    const response = await api.post('/auth/resend-verification', { email });
    return response.data;
  },

  async forgotPassword(email: string) {
    const response = await api.post('/auth/forgot-password', { email });
    return response.data;
  },

  async resetPassword(data: any) {
    const response = await api.post('/auth/reset-password', data);
    return response.data;
  },
};
