import api from '../lib/api';

export interface CreateSupportTicketInput {
  subject: string;
  message: string;
}

export const supportService = {
  async createTicket(data: CreateSupportTicketInput) {
    const response = await api.post('/support', data);
    return response.data;
  },
};
