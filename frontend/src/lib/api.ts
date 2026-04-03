import axios from 'axios';
import { getApiBase } from './apiBase';

const api = axios.create({
  baseURL: getApiBase(),
  withCredentials: true,
});
api.defaults.withCredentials = true;

let csrfFetchPromise: Promise<void> | null = null;

const ensureCsrfToken = async () => {
  if (typeof window === 'undefined') return;
  const existing = sessionStorage.getItem('csrf_token');
  if (existing) return;
  if (!csrfFetchPromise) {
    csrfFetchPromise = fetchCsrfToken().finally(() => {
      csrfFetchPromise = null;
    });
  }
  await csrfFetchPromise;
};

api.interceptors.request.use(
  async (config) => {
    if (typeof window !== 'undefined') {
      const method = (config.method || 'get').toLowerCase();
      const isSafeMethod = method === 'get' || method === 'head' || method === 'options';
      const requestPath = String(config.url || '');
      const isCsrfBootstrapCall = requestPath.includes('/csrf-token');
      if (!isSafeMethod && !isCsrfBootstrapCall) {
        await ensureCsrfToken();
        const csrfToken = sessionStorage.getItem('csrf_token');
        if (csrfToken && config.headers) {
          config.headers['x-csrf-token'] = csrfToken;
        }
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
    const status = error?.response?.status;
    const message = String(error?.response?.data?.message || '').toLowerCase();
    const originalRequest = error?.config || {};

    // Auto-heal CSRF mismatch (common after login/session changes)
    if (
      typeof window !== 'undefined' &&
      status === 403 &&
      message.includes('invalid csrf token') &&
      !originalRequest._csrfRetried
    ) {
      originalRequest._csrfRetried = true;
      sessionStorage.removeItem('csrf_token');
      return fetchCsrfToken().then(() => {
        const refreshed = sessionStorage.getItem('csrf_token');
        if (refreshed) {
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers['x-csrf-token'] = refreshed;
        }
        return api(originalRequest);
      });
    }

    if (typeof window !== 'undefined') {
      if (!status || status >= 500) {
        window.dispatchEvent(new CustomEvent('api-offline'));
      }
    }
    if (error.response && error.response.status === 401) {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        const isAdminArea = path.startsWith('/admin');
        const isAuthPage =
          path.startsWith('/login') ||
          path.startsWith('/register') ||
          path.startsWith('/admin-login');
        // Prevent redirect loop if already on auth pages
        if (!isAuthPage) {
          window.location.href = isAdminArea ? '/admin-login' : '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
