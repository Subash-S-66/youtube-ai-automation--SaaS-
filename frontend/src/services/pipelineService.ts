import api from '../lib/api';

interface GetJobsOptions {
  includeLogs?: boolean;
  includeTotal?: boolean;
  cursor?: string;
}

export const pipelineService = {
  async runPipeline(promptId: string, settings: any, acceptedYouTubeLimitWarning: boolean = false) {
    const response = await api.post('/pipeline/run', { promptId, settings, acceptedYouTubeLimitWarning });
    return response.data;
  },

  async getJobs(page = 1, limit = 10, options: GetJobsOptions = {}) {
    const ts = Date.now();
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    params.set('_ts', String(ts));
    if (typeof options.includeLogs === 'boolean') {
      params.set('includeLogs', String(options.includeLogs));
    }
    if (typeof options.includeTotal === 'boolean') {
      params.set('includeTotal', String(options.includeTotal));
    }
    if (options.cursor) {
      params.set('cursor', options.cursor);
    }

    const response = await api.get(`/pipeline/jobs?${params.toString()}`, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    return response.data;
  },
};
