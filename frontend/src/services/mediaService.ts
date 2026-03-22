import api from '../lib/api';

export const mediaService = {
  getMedia: async () => {
    const response = await api.get('/media');
    return response.data;
  },

  uploadMedia: async (file: File, duration?: number, type?: 'image' | 'thumbnail') => {
    const formData = new FormData();
    formData.append('file', file);
    if (duration !== undefined) {
      formData.append('duration', String(duration));
    }
    if (type) {
      formData.append('type', type);
    }

    const response = await api.post('/media/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  deleteMedia: async (id: string) => {
    const response = await api.delete(`/media/${id}`);
    return response.data;
  },
};