import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api',
});

api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('api-online'));
    }
    return response;
  },
  (error) => {
    if (typeof window !== 'undefined') {
      const status = error?.response?.status;
      if (!status || status >= 500) {
        window.dispatchEvent(new CustomEvent('api-offline'));
      }
    }
    if (error.response && error.response.status === 401) {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        const isAdminArea = path.startsWith('/admin');
        // Prevent redirect loop if already on login page
        if (!path.includes('/login')) {
          localStorage.removeItem('token');
          window.location.href = isAdminArea ? '/admin-login' : '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
