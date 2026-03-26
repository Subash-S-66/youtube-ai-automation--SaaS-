'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '../../../components/layout/DashboardLayout';
import { authService } from '../../../services/authService';
import { supportService } from '../../../services/supportService';
import { Mail, CheckCircle, Clock, Reply, AlertCircle, X, Send, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import io, { Socket } from 'socket.io-client';

export default function AdminTicketsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const [tickets, setTickets] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);

  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedTicket]);

  useEffect(() => {
    const init = async () => {
      try {
        const userData = await authService.getMe();
        if (userData.data.role !== 'admin') {
          router.push('/dashboard');
          return;
        }
        setUser(userData.data);
        await fetchTickets();
        connectAdminSocket();
      } catch (err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router]);

  const fetchTickets = async () => {
    try {
      const res = await supportService.getAdminTickets();
      setTickets(res.data);
    } catch (err) {
      console.error('Failed to fetch tickets', err);
    }
  };

  const connectAdminSocket = () => {
    if (socket) return;
    const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:5000';
    const newSocket = io(backendUrl, { withCredentials: true });

    newSocket.on('connect', () => {
      newSocket.emit('join_admin_support');
    });

    newSocket.on('admin_ticket_update', (data: any) => {
      // Re-fetch tickets to update the latest message preview in the list
      fetchTickets();

      // If we are currently viewing this ticket, append the message
      setSelectedTicket((prevTicket: any) => {
        if (prevTicket && prevTicket._id === data.ticketId) {
          setMessages((prevMsgs) => [...prevMsgs, data.message]);
        }
        return prevTicket;
      });
    });

    newSocket.on('admin_ticket_closed', () => {
      fetchTickets();
    });

    setSocket(newSocket);
  };

  useEffect(() => {
    return () => {
      if (socket) socket.disconnect();
    };
  }, [socket]);

  const openTicketChat = async (t: any) => {
    setSelectedTicket(t);
    setMessages([]);
    try {
      const res = await supportService.getAdminTicketMessages(t._id);
      setMessages(res.data.messages || []);
    } catch (err) {
      console.error('Failed to load messages', err);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedTicket || replying) return;

    setReplying(true);
    try {
      const res = await supportService.sendMessage(replyText, selectedTicket._id);
      setMessages((prev) => [...prev, res.data]);
      setReplyText('');
      fetchTickets(); // update list preview
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  const handleCloseTicket = async () => {
    if (!selectedTicket || selectedTicket.status === 'closed') return;
    if (!window.confirm('Are you sure you want to close this ticket?')) return;

    try {
      await supportService.closeTicket(selectedTicket._id);
      setSelectedTicket({ ...selectedTicket, status: 'closed' });
      fetchTickets();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to close ticket');
    }
  };

  if (loading) {
    return (
      <DashboardLayout user={user}>
        <div className="flex items-center space-x-3 text-slate-400">
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-[#7C5CFF]"></div>
          <span>Loading admin panel…</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={user}>
      <div className="max-w-6xl mx-auto flex h-[calc(100vh-120px)] space-x-6">

        {/* Left Sidebar: Ticket List */}
        <div className="w-1/3 bg-[#111827] border border-[#1A2235] rounded-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#1A2235] bg-[#0B0F1A]">
            <h2 className="text-lg font-semibold text-white">Support Tickets</h2>
            <p className="text-xs text-slate-400 mt-1">Live chat & management</p>
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
                 {selectedTicket.status === 'open' && (
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
                 {messages.map((msg: any) => {
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
                  This ticket is closed. It will disappear from the user's dashboard after 24 hours.
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}
