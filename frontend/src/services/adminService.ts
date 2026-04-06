import api from '../lib/api';

export const adminService = {
  async getStats() {
    const response = await api.get('/admin/stats');
    return response.data;
  },

  async getUsers(page = 1, limit = 10, search = '') {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.append('search', search);
    const response = await api.get(`/admin/users?${params.toString()}`);
    return response.data;
  },

  async getUserDetails(id: string) {
    const response = await api.get(`/admin/users/${id}`);
    return response.data;
  },

  async createAdminUser(data: { email: string; password: string; role?: 'admin' | 'helper' }) {
    const response = await api.post('/admin/users/create-admin', data);
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

  async getPipelineRuntimeStatus() {
    const response = await api.get('/admin/runtime-status');
    return response.data;
  },

  async retryPendingPipelineJobs(limit = 100) {
    const response = await api.post('/admin/pipeline/retry-pending', { limit });
    return response.data;
  },

  async updateSystemConfig(data: {
    betaMode: boolean;
    pipelineRunner?: 'local' | 'azure' | 'remote';
    pipelineServiceUrl?: string;
    pipelineServiceSecret?: string;
    pipelineRunnerPinned?: boolean;
    runEmbeddedWorker?: boolean;
    autoStartEmbeddedWorkerWhenMissing?: boolean;
    includeEmbeddedWorkersInRuntimeStatus?: boolean;
    pipelineWorkerProfile?: 'local' | 'vm' | 'cloud';
    pipelineWorkerConcurrency?: number | null;
    pipelineConcurrencyByPlan?: { free: number; basic: number; pro: number; premium: number };
    pipelineRetriesByPlan?: { free: number; basic: number; pro: number; premium: number };
    pipelineRetryCycles?: number;
    pipelineCycleAcrossRunners?: boolean;
    pipelineRunnerFallbackOrder?: Array<'local' | 'azure' | 'remote'>;
    jobHistoryLimitByPlan?: { free: number; basic: number; pro: number; premium: number };
    jobHistoryMinAgeDays?: number;
    queueWaitTimeoutMinutes?: number;
    processingHardTimeoutMinutes?: number;
    planLimits?: { free: number; basic: number; pro: number; premium: number };
    planValueMap?: { free: number; basic: number; pro: number; premium: number };
  }) {
    const response = await api.post('/admin/config', data);
    return response.data;
  }
};
