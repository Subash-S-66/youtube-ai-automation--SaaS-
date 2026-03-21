'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { authService } from '../../services/authService';
import { supportService } from '../../services/supportService';
import { HelpCircle, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function HelpPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await authService.getMe();
        setUser(userData.data);
      } catch (err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!subject.trim() || !message.trim()) {
        setError('Subject and Message are required.');
        return;
    }

    setSubmitting(true);
    setError('');

    try {
      await supportService.createTicket({ subject, message });
      setSuccess(true);
      setSubject('');
      setMessage('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit support request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout user={user}>
        <div className="flex items-center space-x-3 text-slate-400 text-sm">
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-[#7C5CFF]"></div>
          <span>Loading help…</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={user}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-wide">
            Help <span className="text-gradient-primary">Center</span>
          </h1>
          <p className="text-slate-400 mt-2">
            Need assistance? Send us a message and our support team will get back to you.
          </p>
        </div>

        <div className="bg-[#111827] border border-[#1A2235] rounded-xl p-6 shadow-xl relative overflow-hidden">
          {/* Subtle Background Glow */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#7C5CFF] opacity-10 blur-3xl rounded-full"></div>

          {success ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center text-center py-10 space-y-4"
            >
              <div className="h-16 w-16 bg-[#00D4FF]/20 text-[#00D4FF] rounded-full flex items-center justify-center border border-[#00D4FF]/30">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-bold text-white">Your request has been submitted</h3>
              <p className="text-slate-400">
                We've sent a confirmation email to {user?.user?.email || user?.email}. We will review your ticket and reply shortly.
              </p>
              <button
                onClick={() => setSuccess(false)}
                className="mt-4 px-6 py-2 bg-[#1A2235] hover:bg-[#1A2235]/80 text-white rounded-lg transition-colors border border-slate-700/50"
              >
                Submit another request
              </button>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="subject" className="block text-sm font-medium text-slate-300">
                  Subject
                </label>
                <input
                  id="subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="E.g., Issue with generating a video"
                  className="w-full bg-[#0B0F1A] border border-[#1A2235] text-white rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/50 transition-all placeholder:text-slate-600"
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="message" className="block text-sm font-medium text-slate-300">
                  Message
                </label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your issue in detail..."
                  rows={5}
                  className="w-full bg-[#0B0F1A] border border-[#1A2235] text-white rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/50 transition-all placeholder:text-slate-600 resize-y"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full sm:w-auto px-6 py-2.5 bg-[#7C5CFF] hover:bg-[#6b4de0] text-white rounded-lg font-medium transition-colors shadow-glow-primary flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-5 w-5" />
                    <span>Submit</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
