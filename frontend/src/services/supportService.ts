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

  async closeTicket(id: string, options?: { helperPin?: string; rating?: number; comment?: string }) {
    const response = await api.patch(`/support/ticket/${id}/close`, options || {});
    return response.data;
  },

  async submitFeedback(id: string, rating: number, comment?: string) {
    const response = await api.post(`/support/ticket/${id}/feedback`, { rating, comment });
    return response.data;
  },

  async getUnreadCounts() {
    const response = await api.get('/support/unread-counts');
    return response.data;
  },

  // Admin endpoints
  async getAdminTickets(search = '', status: 'all' | 'open' | 'closed' = 'all') {
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      params.set('search', trimmedSearch);
    }
    if (status !== 'all') {
      params.set('status', status);
    }

    const query = params.toString();
    const response = await api.get(query ? `/support/admin/tickets?${query}` : '/support/admin/tickets');
    return response.data;
  },

  async getAdminTicketMessages(id: string) {
    const response = await api.get(`/support/admin/tickets/${id}/messages`);
    return response.data;
  },
};
