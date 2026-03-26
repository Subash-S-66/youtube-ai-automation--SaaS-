import axios from 'axios';
import { getApiBase } from './apiBase';

const api = axios.create({
  baseURL: getApiBase(),
  withCredentials: true,
});

api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const csrfToken = sessionStorage.getItem('csrf_token');
      if (csrfToken && config.headers && config.method !== 'get' && config.method !== 'head' && config.method !== 'options') {
        config.headers['x-csrf-token'] = csrfToken;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export const fetchCsrfToken = async () => {
  try {
    const { data } = await api.get('/csrf-token');
    if (data.csrfToken) {
      sessionStorage.setItem('csrf_token', data.csrfToken);
    }
  } catch (error) {
    console.warn('Failed to fetch CSRF token');
  }
};

// Fetch once on app load
if (typeof window !== 'undefined') {
  fetchCsrfToken();
}

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
          window.location.href = isAdminArea ? '/admin-login' : '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
