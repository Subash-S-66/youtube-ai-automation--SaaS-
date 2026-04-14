'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authService } from '../../../services/authService';
import { supportService } from '../../../services/supportService';
import { Mail, Search, Send, Loader2 } from 'lucide-react';
import io, { Socket } from 'socket.io-client';

type TicketFilterStatus = 'all' | 'open' | 'closed';

interface AdminUser {
  role?: string;
  plan?: string;
  displayPlan?: string;
  isBetaMode?: boolean;
  [key: string]: unknown;
}

interface TicketUser {
  email?: string;
  plan?: string;
  [key: string]: unknown;
}

interface TicketMessage {
  _id: string;
  sender: string;
  message: string;
  createdAt: string;
}

interface TicketItem {
  _id: string;
  userId?: TicketUser | null;
  status: string;
  latestMessage?: string;
  latestMessageSender?: string;
  updatedAt: string;
}

interface ApiErrorShape {
  response?: {
    data?: {
      message?: string;
    };
  };
}

interface AdminTicketUpdatePayload {
  ticketId: string;
  message: TicketMessage;
}

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null) {
    const err = error as ApiErrorShape;
    const message = err.response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
};

export default function AdminTicketsPage() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketItem | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketStatus, setTicketStatus] = useState<TicketFilterStatus>('all');

  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const ticketSearchRef = useRef('');
  const ticketStatusRef = useRef<TicketFilterStatus>('all');
  const canCloseTickets = user?.role === 'admin';

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedTicket]);

  useEffect(() => {
    ticketSearchRef.current = ticketSearch;
    ticketStatusRef.current = ticketStatus;
  }, [ticketSearch, ticketStatus]);

  const fetchTickets = useCallback(async () => {
    try {
      const res = await supportService.getAdminTickets(ticketSearchRef.current, ticketStatusRef.current);
      const data = (res as { data?: TicketItem[] }).data;
      setTickets(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch tickets', error);
    }
  }, []);

  const connectAdminSocket = useCallback(() => {
    if (socketRef.current) return;

    const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:5000';
    const newSocket = io(backendUrl, { withCredentials: true });

    newSocket.on('connect', () => {
      newSocket.emit('join_admin_support');
    });

    newSocket.on('admin_ticket_update', (data: AdminTicketUpdatePayload) => {
      // Re-fetch tickets to update the latest message preview in the list
      void fetchTickets();

      // If we are currently viewing this ticket, append the message
      setSelectedTicket((prevTicket) => {
        if (prevTicket && prevTicket._id === data.ticketId) {
          setMessages((prevMsgs) => [...prevMsgs, data.message]);
        }
        return prevTicket;
      });
    });

    newSocket.on('admin_ticket_closed', () => {
      void fetchTickets();
    });

    socketRef.current = newSocket;
  }, [fetchTickets]);

  useEffect(() => {
    const init = async () => {
      try {
        const userData = await authService.getMe();
        const role = String(userData?.data?.user?.role || '').toLowerCase();
        if (role !== 'admin' && role !== 'helper') {
          router.push('/dashboard');
          return;
        }
        setUser({
          ...userData.data.user,
          plan: userData.data.plan,
          displayPlan: userData.data.displayPlan,
          isBetaMode: userData.data.isBetaMode,
        });
        await fetchTickets();
        connectAdminSocket();
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, [connectAdminSocket, fetchTickets, router]);

  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'helper')) return;
    void fetchTickets();
  }, [fetchTickets, ticketSearch, ticketStatus, user]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const openTicketChat = async (t: TicketItem) => {
    setSelectedTicket(t);
    setMessages([]);
    try {
      const res = await supportService.getAdminTicketMessages(t._id);
      const data = (res as { data?: { messages?: TicketMessage[] } }).data;
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (error) {
      console.error('Failed to load messages', error);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedTicket || replying) return;

    setReplying(true);
    try {
      const res = await supportService.sendMessage(replyText, selectedTicket._id);
      const data = (res as { data?: TicketMessage }).data;
      if (data) {
        setMessages((prev) => [...prev, data]);
      }
      setReplyText('');
      void fetchTickets(); // update list preview
    } catch (error: unknown) {
      alert(getApiErrorMessage(error, 'Failed to send reply'));
    } finally {
      setReplying(false);
    }
  };

  const handleCloseTicket = async () => {
    if (!canCloseTickets) return;
    if (!selectedTicket || selectedTicket.status === 'closed') return;
    if (!window.confirm('Are you sure you want to close this ticket?')) return;

    try {
      await supportService.closeTicket(selectedTicket._id);
      setSelectedTicket({ ...selectedTicket, status: 'closed' });
      void fetchTickets();
    } catch (error: unknown) {
      alert(getApiErrorMessage(error, 'Failed to close ticket'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center space-x-3 text-slate-400">
        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-[#7C5CFF]"></div>
        <span>Loading support inbox...</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto flex h-[calc(100vh-120px)] space-x-6">

        {/* Left Sidebar: Ticket List */}
        <div className="w-1/3 bg-[#111827] border border-[#1A2235] rounded-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#1A2235] bg-[#0B0F1A]">
            <h2 className="text-lg font-semibold text-white">Support Tickets</h2>
            <p className="text-xs text-slate-400 mt-1">Live chat inbox for support replies</p>
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={ticketSearch}
                  onChange={(e) => setTicketSearch(e.target.value)}
                  placeholder="Search by email, status, message"
                  className="w-full bg-[#111827] border border-[#1A2235] rounded-lg pl-8 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#7C5CFF]"
                />
              </div>
              <select
                value={ticketStatus}
                onChange={(e) => setTicketStatus(e.target.value as 'all' | 'open' | 'closed')}
                className="w-full bg-[#111827] border border-[#1A2235] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#7C5CFF]"
              >
                <option value="all">All statuses</option>
                <option value="open">Open only</option>
                <option value="closed">Closed only</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
            {tickets.map((t) => (
              <button
                key={t._id}
                onClick={() => openTicketChat(t)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedTicket?._id === t._id
                    ? 'bg-[#1E293B] border-[#7C5CFF]/50'
                    : 'bg-[#0B0F1A] border-[#1A2235] hover:border-slate-600'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-sm font-medium text-slate-200 truncate pr-2">
                    {t.userId?.email || 'Unknown User'}
                  </span>
                  {t.status === 'open' ? (
                    <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-[10px] uppercase font-bold rounded">Open</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-slate-500/10 text-slate-400 text-[10px] uppercase font-bold rounded">Closed</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 line-clamp-2">
                   <span className="font-semibold text-slate-300">{t.latestMessageSender === 'admin' ? 'You: ' : 'User: '}</span>
                   {t.latestMessage}
                </p>
                <div className="mt-2 text-[10px] text-slate-500">
                  {new Date(t.updatedAt).toLocaleString()}
                </div>
              </button>
            ))}
            {tickets.length === 0 && (
              <div className="text-center p-4 text-slate-500 text-sm">No tickets found.</div>
            )}
          </div>
        </div>

        {/* Right Side: Chat View */}
        <div className="w-2/3 bg-[#111827] border border-[#1A2235] rounded-xl flex flex-col overflow-hidden relative">
          {!selectedTicket ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
               <Mail className="h-12 w-12 mb-4 opacity-20" />
               <p>Select a ticket from the left to view the chat</p>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-[#1A2235] bg-[#0B0F1A] flex justify-between items-center shrink-0">
                 <div>
                   <h3 className="text-white font-medium">{selectedTicket.userId?.email || 'Unknown User'}</h3>
                   <p className="text-xs text-slate-400 mt-1">Plan: <span className="uppercase text-slate-300">{selectedTicket.userId?.plan || 'Free'}</span></p>
                 </div>
                 {selectedTicket.status === 'open' && canCloseTickets && (
                   <button
                     onClick={handleCloseTicket}
                     className="px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded border border-red-500/20 text-xs transition-colors"
                   >
                     Mark as Closed
                   </button>
                 )}
              </div>

              {/* Chat Thread */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-[#0B0F1A]/50">
                 {messages.map((msg) => {
                  const isAdmin = msg.sender === 'admin';
                  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  return (
                    <div key={msg._id} className={`flex w-full ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 relative shadow-sm ${
                          isAdmin
                            ? 'bg-[#1E293B] border border-[#2D3748] text-white rounded-tr-sm'
                            : 'bg-[#7C5CFF]/10 border border-[#7C5CFF]/20 text-slate-200 rounded-tl-sm'
                        }`}
                      >
                        <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">{msg.message}</p>
                        <div className={`text-[10px] mt-1 text-right ${isAdmin ? 'text-slate-400' : 'text-[#7C5CFF]/70'}`}>
                          {time} {isAdmin ? '✓' : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Box */}
              {selectedTicket.status === 'open' ? (
                <div className="p-4 bg-[#0B0F1A] border-t border-[#1A2235] shrink-0">
                  <form onSubmit={handleSendReply} className="flex space-x-3">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply(e);
                        }
                      }}
                      placeholder="Type your reply to the user... (Press Enter to send)"
                      className="flex-1 bg-[#111827] border border-[#1A2235] text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/50 transition-all text-sm resize-none"
                      rows={2}
                    />
                    <button
                      type="submit"
                      disabled={replying || !replyText.trim()}
                      className="h-full px-6 bg-[#7C5CFF] hover:bg-[#6b4de0] text-white rounded-lg font-medium transition-colors shadow-glow-primary flex flex-col items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                      {replying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="p-4 bg-[#0B0F1A] border-t border-[#1A2235] shrink-0 text-center text-sm text-slate-500">
                  This ticket is closed. Only admins can close tickets; both admins and helpers can reply while open.
                </div>
              )}
            </>
          )}
        </div>

      </div>
  );
}
