import api from '../lib/api';

export const pipelineService = {
  async runPipeline(promptId: string, settings: any, acceptedYouTubeLimitWarning: boolean = false) {
    const response = await api.post('/pipeline/run', { promptId, settings, acceptedYouTubeLimitWarning });
    return response.data;
  },

  async getJobs(page = 1, limit = 10) {
    const response = await api.get(`/pipeline/jobs?page=${page}&limit=${limit}`);
    return response.data;
  },
};
