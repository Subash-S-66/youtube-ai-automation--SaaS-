import api from '../lib/api';

export const pipelineService = {
  async runPipeline(promptId: string, settings: any) {
    const response = await api.post('/pipeline/run', { promptId, settings });
    return response.data;
  },

  async getJobs() {
    const response = await api.get('/pipeline/jobs');
    return response.data;
  },
};
