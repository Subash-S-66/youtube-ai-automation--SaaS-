'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, CheckCircle2, RefreshCw, Zap } from 'lucide-react';
import { authService } from '../../services/authService';
import { paymentService } from '../../services/paymentService';
import DashboardLayout from '../../components/layout/DashboardLayout';

export default function PaymentsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData = await authService.getMe();
        setUser(userData.data);
      } catch (err) {
        authService.logout();
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleUpgrade = async () => {
    setProcessing(true);
    setMessage(null);
    try {
      const response = await paymentService.createCheckoutSession();
      if (response.success && response.url) {
        window.location.href = response.url;
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to start checkout', type: 'error' });
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-[#7C5CFF] animate-spin" />
      </div>
    );
  }

  const isPro = user?.plan === 'pro';

  return (
    <DashboardLayout user={user}>

      <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden mb-6 relative">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-primary opacity-50"></div>
        <div className="px-6 py-5 border-b border-[#1A2235] flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-[#7C5CFF]/10 rounded-xl flex items-center justify-center mr-4 border border-[#7C5CFF]/20 shadow-glow-primary">
              <CreditCard className="h-5 w-5 text-[#7C5CFF]" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Billing & Usage</h2>
          </div>
        </div>

        <div className="p-6 md:p-8">
          {message && (
            <div className={`mb-6 p-4 rounded-xl border flex items-start space-x-3 text-sm font-medium ${
              message.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-[#00D4FF]/10 border-[#00D4FF]/20 text-[#00D4FF]'
            }`}>
              {message.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* Current Plan Overview */}
            <div className="bg-[#0B0F1A] rounded-2xl p-6 border border-[#1A2235]">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Current Plan</h3>
              <div className="flex items-end mb-2">
                <span className="text-4xl font-extrabold text-white capitalize">{user?.plan}</span>
                <span className="text-sm text-slate-500 mb-1 ml-2">/ month</span>
              </div>
              <p className="text-sm text-slate-400 mb-6">
                {isPro ? 'You have access to all premium features and elevated limits.' : 'Upgrade to unlock priority queues and elevated upload limits.'}
              </p>

              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Daily Usage</h4>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">Uploads</span>
                    <span className="text-white font-mono">{user?.uploadsUsedToday} / {user?.uploadLimitPerDay}</span>
                  </div>
                  <div className="w-full bg-[#111827] rounded-full h-2 border border-[#1A2235]">
                    <div
                      className={`h-2 rounded-full ${isPro ? 'bg-[#00D4FF] shadow-[0_0_8px_rgba(0,212,255,0.6)]' : 'bg-[#7C5CFF]'}`}
                      style={{ width: `${Math.min((user?.uploadsUsedToday / user?.uploadLimitPerDay) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Upgrade Prompt */}
            {!isPro && (
              <div className="bg-[#1A2235]/40 rounded-2xl p-6 border border-[#7C5CFF]/30 flex flex-col justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-primary opacity-5 pointer-events-none"></div>
                <div className="flex items-center mb-4 relative z-10">
                  <Zap className="h-6 w-6 text-[#FF4FD8] mr-2" />
                  <h3 className="text-lg font-bold text-white">Upgrade to Pro</h3>
                </div>
                <ul className="space-y-3 mb-8 relative z-10">
                  <li className="flex items-center text-sm text-slate-300">
                    <CheckCircle2 className="h-4 w-4 mr-3 text-[#00D4FF]" /> 100 Daily Uploads
                  </li>
                  <li className="flex items-center text-sm text-slate-300">
                    <CheckCircle2 className="h-4 w-4 mr-3 text-[#00D4FF]" /> Priority Processing Queue
                  </li>
                  <li className="flex items-center text-sm text-slate-300">
                    <CheckCircle2 className="h-4 w-4 mr-3 text-[#00D4FF]" /> Custom Voice Selection
                  </li>
                </ul>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleUpgrade}
                  disabled={processing}
                  className="w-full py-3 px-4 bg-gradient-primary text-white font-bold rounded-full shadow-glow-primary hover:shadow-glow-primary-hover transition-all disabled:opacity-50 flex items-center justify-center relative z-10"
                >
                  {processing ? <RefreshCw className="h-5 w-5 animate-spin mr-2" /> : null}
                  {processing ? 'Processing...' : 'Upgrade Now - $29/mo'}
                </motion.button>
              </div>
            )}

            {isPro && (
              <div className="bg-[#1A2235]/40 rounded-2xl p-6 border border-[#00D4FF]/30 flex flex-col justify-center items-center text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-[#00D4FF]/10 to-[#7C5CFF]/10 pointer-events-none"></div>
                <div className="h-16 w-16 bg-[#00D4FF]/20 rounded-full flex items-center justify-center mb-4 relative z-10 shadow-[0_0_15px_rgba(0,212,255,0.4)]">
                  <CheckCircle2 className="h-8 w-8 text-[#00D4FF]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2 relative z-10">You are a Pro Member</h3>
                <p className="text-sm text-[#00D4FF]/80 relative z-10">Thank you for your support. Your account is fully upgraded with priority features.</p>
              </div>
            )}
          </div>
        </div>
      </div>

    </DashboardLayout>
  );
}
