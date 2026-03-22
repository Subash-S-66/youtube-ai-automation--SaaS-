'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ShieldAlert, Sparkles, Zap, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService';
import { paymentService } from '../../services/paymentService';
import { planService } from '../../services/planService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { cn } from '../../lib/utils';

interface Plan {
  id: string;
  name: string;
  price: number;
  discountPercentage: number;
  limit: number;
  features: string[];
  recommended?: boolean;
}

export default function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [userData, plansData] = await Promise.all([
           authService.getMe(),
           planService.getPlans() // Assumes this endpoint works or is updated
        ]);

        setUser(userData.data);

        // Map backend plans to frontend structure and sort by price
        if (plansData && plansData.data) {
          const mappedPlans = plansData.data.map((p: any) => {
             const dynamicFeatures = [
               `${p.limits?.daily_upload_limit || 0} video uploads per day`,
               `${p.limits?.max_channels || 0} YouTube channels`,
               p.features?.voice_selection ? 'Premium AI voices' : 'Standard voices',
               p.features?.scheduling ? 'Scheduling enabled' : 'No scheduling',
               p.features?.story_mode ? 'Story Mode enabled' : 'No Story Mode',
               p.features?.cta ? 'Custom Call-to-Actions' : 'No custom CTAs',
               p.features?.format_selection ? 'Multiple format selections' : 'Standard format'
             ];

             return {
               id: p.name,
               name: p.name.charAt(0).toUpperCase() + p.name.slice(1),
               price: p.price,
               discountPercentage: p.discountPercentage || 0,
               limit: p.limits?.daily_upload_limit || 0,
               features: dynamicFeatures,
               recommended: p.name === 'pro'
             };
          }).sort((a: Plan, b: Plan) => a.price - b.price);
          setPlans(mappedPlans);
        }
      } catch (err) {
        authService.logout();
      } finally {
        setLoading(false);
      }
    };
    fetchData();
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

  const currentPlanId = user?.isBetaMode ? 'free' : (user?.plan || 'free');

  return (
    <DashboardLayout user={user}>
      <div className="max-w-none mx-auto py-12 px-6 sm:px-10 lg:px-16 xl:px-24 2xl:px-32">

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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
          {plans.map((plan, index) => {
            const isCurrentPlan = currentPlanId === plan.id;
            const hasDiscount = plan.discountPercentage > 0;
            const discountedPrice = hasDiscount ? plan.price * (1 - plan.discountPercentage / 100) : plan.price;

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
                {plan.recommended && !hasDiscount && (
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-primary text-white text-[10px] font-extrabold uppercase tracking-widest px-4 py-1.5 rounded-full shadow-glow-primary flex items-center">
                    <Sparkles className="h-3 w-3 mr-1.5" /> Most Popular
                  </div>
                )}

                {hasDiscount && (
                   <div className="absolute -top-3 right-4 bg-gradient-to-r from-[#FF4FD8] to-[#7C5CFF] text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full shadow-[0_0_15px_rgba(255,79,216,0.3)] flex items-center z-10">
                     Save {plan.discountPercentage}%
                   </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white mb-2 capitalize">{plan.name}</h3>
                  <div className="flex items-baseline mb-4">
                    {hasDiscount ? (
                       <>
                         <span className="text-4xl font-extrabold text-white tracking-tight mr-2">${discountedPrice.toFixed(0)}</span>
                         <span className="text-lg font-bold text-slate-500 line-through decoration-red-500/50 mr-1">${plan.price}</span>
                         <span className="text-lg text-slate-400 font-medium">/mo</span>
                       </>
                    ) : (
                       <>
                         <span className="text-4xl font-extrabold text-white tracking-tight mr-1">${plan.price}</span>
                         <span className="text-lg text-slate-400 font-medium">/mo</span>
                       </>
                    )}
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
