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

  async getAdminTickets() {
    const response = await api.get('/support/admin');
    return response.data;
  },

  async replyToTicket(id: string, message: string, closeTicket: boolean = false) {
    const response = await api.post(`/support/admin/${id}/reply`, { message, closeTicket });
    return response.data;
  },

  async closeTicket(id: string) {
    const response = await api.post(`/support/admin/${id}/close`);
    return response.data;
  },
};
