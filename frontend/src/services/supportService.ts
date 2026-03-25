import api from '../lib/api';

export const supportService = {
  // User endpoints
  async getUserTicket() {
    const response = await api.get('/support/ticket');
    return response.data;
  },

  async sendMessage(message: string, ticketId?: string) {
    const response = await api.post('/support/message', { message, ticketId });
    return response.data;
  },

  async closeTicket(id: string) {
    const response = await api.patch(`/support/ticket/${id}/close`);
    return response.data;
  },

  // Admin endpoints
  async getAdminTickets() {
    const response = await api.get('/support/admin/tickets');
    return response.data;
  },

  async getAdminTicketMessages(id: string) {
    const response = await api.get(`/support/admin/tickets/${id}/messages`);
    return response.data;
  },
};
