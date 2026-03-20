'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, CheckCircle2, RefreshCw, Zap, Sparkles } from 'lucide-react';
import { authService } from '../../services/authService';
import { paymentService } from '../../services/paymentService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { cn } from '../../lib/utils';

interface Plan {
  id: string;
  name: string;
  price: string;
  limit: number;
  features: string[];
  recommended?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0/mo',
    limit: 2,
    features: ['2 video uploads per day', '1 YouTube channel', 'Basic AI generation', 'Standard voices', 'No scheduling / No Story Mode'],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '$10/mo',
    limit: 10,
    features: ['10 video uploads per day', '3 YouTube channels', 'Faster AI generation', 'Story Mode & Scheduling enabled', 'Email support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$25/mo',
    limit: 25,
    features: ['25 video uploads per day', '10 YouTube channels', 'Priority generation queue', 'Premium AI voices', 'Priority support'],
    recommended: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: '$99/mo',
    limit: 100,
    features: ['100 video uploads per day', '50 YouTube channels', 'Instant generation queue', 'All AI voices unlocked', '24/7 dedicated support', 'Custom templates'],
  }
];

export default function PaymentsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
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

  const handleUpgrade = async (planId: string) => {
    setProcessing(planId);
    setMessage(null);
    try {
      const response = await paymentService.createCheckoutSession(planId);
      if (response.success && response.url) {
        window.location.href = response.url;
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to start checkout', type: 'error' });
      setProcessing(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-[#7C5CFF] animate-spin" />
      </div>
    );
  }

  const currentPlanId = user?.plan || 'free';

  return (
    <DashboardLayout user={user}>

      <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden mb-6 relative">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-primary opacity-50"></div>
        <div className="px-6 py-5 border-b border-[#1A2235] flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-[#7C5CFF]/10 rounded-xl flex items-center justify-center mr-4 border border-[#7C5CFF]/20 shadow-glow-primary">
              <CreditCard className="h-5 w-5 text-[#7C5CFF]" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Subscriptions & Usage</h2>
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

          <div className="mb-10">
            {/* Current Plan Overview */}
            <div className="bg-[#0B0F1A] rounded-2xl p-6 border border-[#1A2235]">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Current Plan</h3>
              <div className="flex items-end mb-2">
                <span className="text-4xl font-extrabold text-white capitalize">{user?.plan}</span>
                <span className="text-sm text-slate-500 mb-1 ml-2">/ month</span>
              </div>
              {user?.cancelAtPeriodEnd && (
                 <div className="mt-2 inline-block px-3 py-1 bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-bold rounded">
                   Cancels at Period End
                 </div>
              )}

              <div className="space-y-4 mt-6">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Daily Usage</h4>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">Uploads</span>
                    <span className="text-white font-mono">{user?.uploadsUsedToday} / {user?.uploadLimitPerDay}</span>
                  </div>
                  <div className="w-full bg-[#111827] rounded-full h-2 border border-[#1A2235]">
                    <div
                      className={`h-2 rounded-full ${user?.plan !== 'free' ? 'bg-[#00D4FF] shadow-[0_0_8px_rgba(0,212,255,0.6)]' : 'bg-[#7C5CFF]'}`}
                      style={{ width: `${Math.min((user?.uploadsUsedToday / user?.uploadLimitPerDay) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold text-white mb-6">Available Plans</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {PLANS.map((plan, index) => {
                const isCurrentPlan = currentPlanId === plan.id;

                return (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={cn(
                      "relative bg-[#0B0F1A] rounded-2xl p-6 border flex flex-col transition-all hover:scale-[1.02]",
                      plan.recommended
                        ? "border-[#7C5CFF]/50 shadow-[0_0_20px_rgba(124,92,255,0.1)] bg-gradient-to-b from-[#0B0F1A] to-[#7C5CFF]/5"
                        : "border-[#1A2235] hover:border-slate-700"
                    )}
                  >
                    {plan.recommended && (
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-primary text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full shadow-glow-primary flex items-center">
                        <Sparkles className="h-3 w-3 mr-1" /> Popular
                      </div>
                    )}

                    <div className="mb-4">
                      <h3 className="text-lg font-bold text-white mb-1 capitalize">{plan.name}</h3>
                      <div className="flex items-baseline mb-2">
                        <span className="text-3xl font-extrabold text-white tracking-tight">{plan.price}</span>
                      </div>
                    </div>

                    <div className="flex-1">
                      <ul className="space-y-3 mb-6">
                        {plan.features.map((feature, i) => (
                          <li key={i} className="flex items-start text-xs text-slate-300">
                            <CheckCircle2 className="h-4 w-4 mr-2 text-[#7C5CFF] flex-shrink-0" />
                            <span className="leading-tight">{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-auto">
                      <button
                        onClick={() => handleUpgrade(plan.id)}
                        disabled={isCurrentPlan || processing !== null}
                        className={cn(
                          "w-full py-2.5 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center",
                          isCurrentPlan
                            ? "bg-[#111827] text-[#00D4FF] cursor-not-allowed border border-[#00D4FF]/30"
                            : plan.recommended
                              ? "bg-gradient-primary text-white shadow-glow-primary hover:shadow-glow-primary-hover"
                              : "bg-white/5 text-white hover:bg-white/10 border border-white/10"
                        )}
                      >
                        {processing === plan.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : isCurrentPlan ? (
                          'Current Plan'
                        ) : (
                          <>Upgrade <Zap className="h-3.5 w-3.5 ml-1.5" /></>
                        )}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

    </DashboardLayout>
  );
}
