'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { authService } from '../../services/authService';
import { supportService } from '../../services/supportService';
import { Send, Loader2, Info } from 'lucide-react';
import io, { Socket } from 'socket.io-client';

interface HelpUser {
  [key: string]: unknown;
}

interface TicketRecord {
  _id: string;
  status?: string;
  expireAt?: string;
}

interface TicketMessage {
  _id: string;
  sender: string;
  message: string;
  createdAt: string;
}

interface SupportTicketPayload {
  ticket: TicketRecord;
  messages: TicketMessage[];
}

interface SupportTicketResponse {
  data?: SupportTicketPayload;
}

interface SupportSendResponse {
  ticketId?: string;
}

interface ApiErrorShape {
  response?: {
    data?: {
      message?: string;
    };
  };
}

const getApiErrorMessage = (err: unknown, fallback: string): string => {
  if (typeof err === 'object' && err) {
    const maybeApiError = err as ApiErrorShape;
    const message = maybeApiError.response?.data?.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
};

export default function HelpPage() {
  const [user, setUser] = useState<HelpUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, ticket]);

  const connectSocket = useCallback((ticketId: string) => {
    if (socket) return;
    // Use configured public API origin in production; fall back to empty
    // string so socket.io will connect to same-origin when not provided.
    const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || '';
    const newSocket = io(backendUrl, {
      withCredentials: true,
    });

    newSocket.on('connect', () => {
      newSocket.emit('join_ticket', ticketId);
    });

    newSocket.on('receive_message', (msg: TicketMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    newSocket.on('ticket_closed', (data: { expireAt?: string }) => {
      setTicket((prev) => (prev ? { ...prev, status: 'closed', expireAt: data.expireAt } : null));
    });

    setSocket(newSocket);
  }, [socket]);

  const fetchTicket = useCallback(async () => {
    try {
      const res = await supportService.getUserTicket() as SupportTicketResponse;
      if (res.data) {
        setTicket(res.data.ticket);
        setMessages(res.data.messages || []);
        connectSocket(res.data.ticket._id);
      } else {
        setTicket(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to fetch ticket', err);
    }
  }, [connectSocket]);

  useEffect(() => {
    const init = async () => {
      try {
        const userData = await authService.getMe() as { data: HelpUser };
        setUser(userData.data);
        await fetchTicket();
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchTicket]);

  // Cleanup socket on unmount
  useEffect(() => {
    return () => {
      if (socket) socket.disconnect();
    };
  }, [socket]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || submitting) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await supportService.sendMessage(inputMessage, ticket?._id) as SupportSendResponse;

      // If a new ticket was created
      if (!ticket && res.ticketId) {
        await fetchTicket(); // Fetch the newly created ticket state
      }

      setInputMessage('');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to send message'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseTicket = async () => {
    if (!ticket || ticket.status === 'closed') return;
    if (!window.confirm('Are you sure you want to close this ticket?')) return;

    try {
      await supportService.closeTicket(ticket._id);
      await fetchTicket();
    } catch (err) {
      console.error('Failed to close ticket', err);
    }
  };

  if (loading) {
    return (
      <DashboardLayout user={user}>
        <div className="flex items-center space-x-3 text-slate-400 text-sm">
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-[#7C5CFF]"></div>
          <span>Loading help...</span>
        </div>
      </DashboardLayout>
    );
  }

  const isClosed = ticket?.status === 'closed';

  return (
    <DashboardLayout user={user}>
      <div className="max-w-3xl mx-auto h-[calc(100vh-120px)] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide">
              Help <span className="text-gradient-primary">Center</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">Live chat with our support team</p>
          </div>
          {ticket && !isClosed && (
            <button
              onClick={handleCloseTicket}
              className="text-sm px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors"
            >
              Close Ticket
            </button>
          )}
        </div>

        {/* Input Area (Always on top or above chat) */}
        {!isClosed && (
          <div className="bg-[#111827] border border-[#1A2235] rounded-xl p-4 shadow-md mb-4 shrink-0">
            <form onSubmit={handleSendMessage} className="flex items-end space-x-3">
              <div className="flex-1">
                <textarea
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                  placeholder="Type your message here... (Press Enter to send)"
                  className="w-full bg-[#0B0F1A] border border-[#1A2235] text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/50 transition-all placeholder:text-slate-600 resize-none"
                  rows={2}
                  maxLength={1000}
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !inputMessage.trim()}
                className="h-[52px] px-6 bg-[#7C5CFF] hover:bg-[#6b4de0] text-white rounded-lg font-medium transition-colors shadow-glow-primary flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </button>
            </form>
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          </div>
        )}

        {/* WhatsApp Style Chat Thread */}
        {ticket && (
          <div className="flex-1 bg-[#111827] border border-[#1A2235] rounded-xl flex flex-col overflow-hidden shadow-lg relative">
            {/* Background Pattern */}
            <div
              className="absolute inset-0 opacity-5 pointer-events-none"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
              }}
            ></div>

            {/* Chat Status Header */}
            {isClosed && (
              <div className="bg-[#1A2235] px-4 py-3 flex items-center justify-center space-x-2 border-b border-slate-700/50 z-10 shrink-0">
                <Info className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300 text-sm">
                  This ticket was closed. This conversation is read-only and will disappear in 24 hours.
                </span>
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 z-10 custom-scrollbar">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm italic">
                  No messages yet. Send a message to start the chat.
                </div>
              ) : (
                messages.map((msg) => {
                  const isUser = msg.sender === 'user';
                  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  return (
                    <div key={msg._id} className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 relative shadow-sm ${
                          isUser
                            ? 'bg-[#7C5CFF] text-white rounded-tr-sm'
                            : 'bg-[#1E293B] border border-[#2D3748] text-slate-200 rounded-tl-sm'
                        }`}
                      >
                        <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{msg.message}</p>
                        <div className={`text-[10px] mt-1 text-right ${isUser ? 'text-white/70' : 'text-slate-400'}`}>
                          {time}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}