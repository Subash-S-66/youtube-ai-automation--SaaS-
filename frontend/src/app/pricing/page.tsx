'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ShieldAlert, Sparkles, Zap, RefreshCw } from 'lucide-react';
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

export default function PricingPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await authService.getMe();
        setUser(userData.data);
      } catch (err) {
        authService.logout();
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, []);

  const handleUpgrade = async (planId: string) => {
    // The current backend endpoint `/api/payment/create-checkout` is strictly wired to Stripe Pro via STRIPE_PRICE_ID
    // If we wanted dynamic plans, we'd pass the planId. For now, we will call it and handle the redirection.
    setUpgrading(planId);
    setMessage(null);
    try {
      // If we had dynamic plan IDs: await paymentService.createCheckoutSession(planId);
      const res = await paymentService.createCheckoutSession();
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      // Handle the generic placeholder case or error cleanly
      setMessage({ text: err.response?.data?.message || 'Upgrade API not fully configured for this plan yet.', type: 'error' });
    } finally {
      setUpgrading(null);
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
    <DashboardLayout user={user?.user}>
      <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6">

        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-slate-400 mb-4"
          >
            Upgrade your creative flow
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-slate-400"
          >
            Choose the perfect plan to scale your YouTube automation and generate more shorts every day.
          </motion.p>
        </div>

        {message && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("p-4 mb-8 rounded-xl border flex items-center text-sm font-medium", message.type === 'error' ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-green-500/10 border-green-500/20 text-green-400")}>
            <ShieldAlert className="h-5 w-5 mr-3 flex-shrink-0" />
            {message.text}
          </motion.div>
        )}

        {/* Pricing Cards */}
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
                  "relative bg-[#111827] rounded-3xl p-8 border flex flex-col transition-all hover:scale-[1.02]",
                  plan.recommended
                    ? "border-[#7C5CFF]/50 shadow-[0_0_30px_rgba(124,92,255,0.15)] bg-gradient-to-b from-[#111827] to-[#7C5CFF]/5"
                    : "border-[#1A2235] hover:border-slate-700"
                )}
              >
                {plan.recommended && (
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-primary text-white text-[10px] font-extrabold uppercase tracking-widest px-4 py-1.5 rounded-full shadow-glow-primary flex items-center">
                    <Sparkles className="h-3 w-3 mr-1.5" /> Most Popular
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white mb-2 capitalize">{plan.name}</h3>
                  <div className="flex items-baseline mb-4">
                    <span className="text-4xl font-extrabold text-white tracking-tight">{plan.price}</span>
                  </div>
                  <p className="text-sm text-slate-400">Up to <span className="text-[#00D4FF] font-bold">{plan.limit}</span> videos / day</p>
                </div>

                <div className="flex-1">
                  <ul className="space-y-4 mb-8">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start text-sm text-slate-300">
                        <CheckCircle2 className="h-5 w-5 mr-3 text-[#7C5CFF] flex-shrink-0" />
                        <span className="leading-tight">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-auto">
                  <button
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={isCurrentPlan || upgrading !== null}
                    className={cn(
                      "w-full py-3.5 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center",
                      isCurrentPlan
                        ? "bg-[#1A2235] text-slate-400 cursor-not-allowed border border-[#1A2235]"
                        : plan.recommended
                          ? "bg-gradient-primary text-white shadow-glow-primary hover:shadow-glow-primary-hover"
                          : "bg-white/5 text-white hover:bg-white/10 border border-white/10"
                    )}
                  >
                    {upgrading === plan.id ? (
                      <RefreshCw className="h-5 w-5 animate-spin" />
                    ) : isCurrentPlan ? (
                      'Current Plan'
                    ) : (
                      <>Upgrade to {plan.name} <Zap className="h-4 w-4 ml-1.5" /></>
                    )}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

      </div>
    </DashboardLayout>
  );
}
