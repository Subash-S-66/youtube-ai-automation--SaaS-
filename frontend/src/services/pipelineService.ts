import api from '../lib/api';

export const pipelineService = {
  async runPipeline(promptId: string, settings: any, acceptedYouTubeLimitWarning: boolean = false) {
    const response = await api.post('/pipeline/run', { promptId, settings, acceptedYouTubeLimitWarning });
    return response.data;
  },

  async getJobs() {
    const response = await api.get('/pipeline/jobs');
    return response.data;
  },
};
