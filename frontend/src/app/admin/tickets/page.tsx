'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, RefreshCw, Send, CheckCircle2 } from 'lucide-react';
import { supportService } from '../../../services/supportService';
import AppModal, { AppModalType } from '../../../components/ui/AppModal';
import { cn } from '../../../lib/utils';

interface Ticket {
  _id: string;
  subject: string;
  message: string;
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  userId: { email?: string } | string;
  replies?: { message: string; repliedBy: string; createdAt: string }[];
}

export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    type: AppModalType;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
  }>({
    isOpen: false,
    title: '',
    description: '',
    type: 'info',
  });

  const loadTickets = async () => {
    const res = await supportService.getAdminTickets();
    if (res?.success) {
      setTickets(res.data || []);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        if (!isMounted) return;
        await loadTickets();
      } catch (error) {
        console.error('Admin tickets init error', error);
      }
    };
    init();
    return () => { isMounted = false; };
  }, []);

  const handleReply = async (closeTicket: boolean) => {
    if (!selected) return;
    if (!reply.trim()) return;
    setSending(true);
    try {
      await supportService.replyToTicket(selected._id, reply.trim(), closeTicket);
      setReply('');
      await loadTickets();
      setSelected(prev => prev ? { ...prev, status: closeTicket ? 'closed' : prev.status, replies: [...(prev.replies || []), { message: reply.trim(), repliedBy: currentUser?.email || 'admin', createdAt: new Date().toISOString() }] } : prev);
      setModalConfig({
        isOpen: true,
        title: 'Reply Sent',
        description: closeTicket ? 'Reply sent and ticket closed.' : 'Reply sent successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to reply to ticket.',
        type: 'error',
        confirmText: 'Dismiss',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSending(false);
    }
  };

  const handleClose = async () => {
    if (!selected) return;
    setSending(true);
    try {
      await supportService.closeTicket(selected._id);
      await loadTickets();
      setSelected(prev => prev ? { ...prev, status: 'closed' } : prev);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="max-w-7xl mx-auto py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden">
            <div className="p-4 border-b border-[#1A2235] flex items-center">
              <MessageSquare className="h-5 w-5 text-[#00D4FF] mr-2" />
              <h2 className="text-lg font-bold text-white">Support Tickets</h2>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {tickets.map(ticket => (
                <button
                  key={ticket._id}
                  onClick={() => setSelected(ticket)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-[#1A2235] hover:bg-[#1A2235]/40 transition-colors',
                    selected?._id === ticket._id && 'bg-[#1A2235]/60'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-white font-semibold truncate">{ticket.subject}</p>
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-bold', ticket.status === 'open' ? 'bg-[#00D4FF]/20 text-[#00D4FF]' : 'bg-green-500/20 text-green-400')}>
                      {ticket.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 truncate">{typeof ticket.userId === 'string' ? ticket.userId : ticket.userId?.email}</p>
                  <p className="text-xs text-slate-500 mt-1">{new Date(ticket.createdAt).toLocaleString()}</p>
                </button>
              ))}
              {!tickets.length && (
                <div className="p-6 text-sm text-slate-500">No tickets found.</div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            {!selected ? (
              <div className="bg-[#111827] border border-[#1A2235] rounded-2xl p-6 text-slate-400">
                Select a ticket to view and reply.
              </div>
            ) : (
              <>
                <div className="bg-[#111827] border border-[#1A2235] rounded-2xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-white">{selected.subject}</h3>
                      <p className="text-xs text-slate-500 mt-1">From: {typeof selected.userId === 'string' ? selected.userId : selected.userId?.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={sending || selected.status === 'closed'}
                      className="text-xs px-3 py-1.5 rounded-lg border border-[#1A2235] text-slate-300 hover:text-white hover:border-[#7C5CFF]/60 transition-colors disabled:opacity-50"
                    >
                      Close Ticket
                    </button>
                  </div>
                  <div className="mt-4 text-slate-300 whitespace-pre-wrap text-sm">
                    {selected.message}
                  </div>
                </div>

                <div className="bg-[#111827] border border-[#1A2235] rounded-2xl p-6">
                  <h4 className="text-sm font-semibold text-slate-300 mb-3">Replies</h4>
                  <div className="space-y-3 max-h-[240px] overflow-y-auto pr-1">
                    {(selected.replies || []).length === 0 && (
                      <div className="text-sm text-slate-500">No replies yet.</div>
                    )}
                    {(selected.replies || []).map((r, idx) => (
                      <div key={idx} className="bg-[#0B0F1A] border border-[#1A2235] rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400">{r.repliedBy}</span>
                          <span className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-slate-200 mt-2 whitespace-pre-wrap">{r.message}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#111827] border border-[#1A2235] rounded-2xl p-6">
                  <h4 className="text-sm font-semibold text-slate-300 mb-3">Reply</h4>
                  <textarea
                    rows={4}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Write a response to the customer..."
                    className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none resize-none"
                  />
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleReply(false)}
                      disabled={sending || !reply.trim()}
                      className="flex-1 py-2 bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50"
                    >
                      {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" /> Send Reply</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReply(true)}
                      disabled={sending || !reply.trim()}
                      className="flex-1 py-2 bg-[#00D4FF] hover:bg-[#00b5d8] text-black font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50"
                    >
                      {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-2" /> Reply & Close</>}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <AppModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        description={modalConfig.description}
        type={modalConfig.type}
        onConfirm={modalConfig.onConfirm}
        onCancel={modalConfig.onCancel}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
      />
    </>
  );
}
