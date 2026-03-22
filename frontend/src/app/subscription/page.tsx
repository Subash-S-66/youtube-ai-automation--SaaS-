'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, CheckCircle2, RefreshCw, Zap, Sparkles } from 'lucide-react';
import { authService } from '../../services/authService';
import { paymentService } from '../../services/paymentService';
import { openRazorpayCheckout, RazorpaySuccessResponse } from '../../lib/razorpay';
import { planService } from '../../services/planService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { cn } from '../../lib/utils';
import UpgradeOptionsModal from '../../components/ui/UpgradeOptionsModal';
import { computeProrationDays, getRemainingDays } from '../../lib/proration';

interface Plan {
  id: string;
  name: string;
  price: number;
  discountPercentage: number;
  limit: number;
  features: string[];
  recommended?: boolean;
}

export default function PaymentsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [pendingUpgradePlan, setPendingUpgradePlan] = useState<string | null>(null);

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
             const planId = String(p.name || '').toLowerCase();
             const rawName = String(p.name || planId || 'plan');
             const dynamicFeatures = [
               `${p.limits?.daily_upload_limit || 0} video uploads per day`,
               `${p.limits?.max_channels || 0} YouTube channels`,
               p.features?.voice_selection ? 'Premium AI voices' : 'Standard voices',
               p.features?.scheduling ? 'Scheduling enabled' : 'No scheduling',
               p.features?.story_mode ? 'Story Mode enabled' : 'No Story Mode',
               p.features?.cta ? 'Custom Call-to-Actions' : 'No custom CTAs',
               p.features?.format_selection ? 'Multiple format selections' : 'Standard format',
               p.features?.template_customization ? 'Subtitle font & color control' : 'No subtitle customization',
               p.features?.custom_media ? 'Custom media library' : 'No custom media'
             ];

             return {
               id: planId,
               name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
               price: p.price,
               discountPercentage: p.discountPercentage || 0,
               limit: p.limits?.daily_upload_limit || 0,
               features: dynamicFeatures,
               recommended: planId === 'pro'
             };
          }).sort((a: Plan, b: Plan) => a.price - b.price);
          setPlans(mappedPlans);
        }
      } catch (err) {
        authService.handleAuthError(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const beginCheckout = async (planId: string) => {
    setProcessing(planId);
    setMessage(null);
    try {
      const response = await paymentService.createCheckoutSession(planId);
      const order = response?.data;
      if (!order?.orderId) {
        throw new Error('Invalid checkout response');
      }

      await openRazorpayCheckout(order, {
        onSuccess: async (rzpResponse: RazorpaySuccessResponse) => {
          try {
            await paymentService.confirmPayment(rzpResponse as any);
            const userData = await authService.getMe();
            setUser(userData.data);
            setMessage({ text: 'Subscription upgraded successfully! Your limits have been updated.', type: 'success' });
          } catch (err: any) {
            setMessage({ text: err.response?.data?.message || 'Payment verification failed. Please contact support.', type: 'error' });
          } finally {
            setProcessing(null);
          }
        },
        onDismiss: () => {
          setProcessing(null);
        },
        onFailure: (error) => {
          setMessage({ text: error.message || 'Payment failed', type: 'error' });
          setProcessing(null);
        },
      });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to start checkout', type: 'error' });
      setProcessing(null);
    }
  };

  const handleRenew = async () => {
    if (currentPlanId === 'free') return;
    setProcessing(currentPlanId);
    setMessage(null);
    try {
      const response = await paymentService.renewPlan();
      const order = response?.data;
      if (!order?.orderId) {
        throw new Error('Invalid checkout response');
      }

      await openRazorpayCheckout(order, {
        onSuccess: async (rzpResponse: RazorpaySuccessResponse) => {
          try {
            await paymentService.confirmPayment(rzpResponse as any);
            const userData = await authService.getMe();
            setUser(userData.data);
            setMessage({ text: 'Subscription renewed successfully! 30 days added.', type: 'success' });
          } catch (err: any) {
            setMessage({ text: err.response?.data?.message || 'Payment verification failed. Please contact support.', type: 'error' });
          } finally {
            setProcessing(null);
          }
        },
        onDismiss: () => {
          setProcessing(null);
        },
        onFailure: (error) => {
          setMessage({ text: error.message || 'Payment failed', type: 'error' });
          setProcessing(null);
        },
      });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to start checkout', type: 'error' });
      setProcessing(null);
    }
  };

  const handleUpgrade = async (planId: string) => {
    const targetRank = planRank[String(planId).toLowerCase()] ?? 0;
    if (isSubscriptionActive && currentRank < targetRank && remainingDays > 0) {
      setPendingUpgradePlan(planId);
      setUpgradeModalOpen(true);
      return;
    }
    await beginCheckout(planId);
  };

  if (loading) {
    return (
      <DashboardLayout user={user}>
        <div className="flex items-center space-x-3 text-slate-400 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin text-[#7C5CFF]" />
          <span>Loading subscriptions...</span>
        </div>
      </DashboardLayout>
    );
  }

  const currentPlanId = String((user?.isBetaMode ? 'free' : (user?.plan || 'free'))).toLowerCase();
  const currentPlan = plans.find(plan => plan.id === currentPlanId);
  const subscriptionExpiry = user?.user?.subscriptionExpiresAt
    ? new Date(user.user.subscriptionExpiresAt).toLocaleDateString()
    : null;
  const subscriptionExpiryText = (() => {
    const expiresAt = user?.user?.subscriptionExpiresAt;
    if (!expiresAt) return null;
    const expiryDate = new Date(expiresAt);
    const diffMs = expiryDate.getTime() - Date.now();
    if (diffMs <= 0) return 'expired';
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
    if (diffHours <= 24) return `expires in ${diffHours} hour${diffHours === 1 ? '' : 's'}`;
    const diffDays = Math.ceil(diffHours / 24);
    return `expires in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
  })();
  const displayPlanLabel = user?.isBetaMode ? 'free' : (user?.displayPlan || user?.plan || 'free');
  const isSubscriptionActive = (user?.subscriptionStatus || user?.user?.subscriptionStatus) === 'active';
  const planRank: Record<string, number> = { free: 0, basic: 1, pro: 2, premium: 4 };
  const currentRank = planRank[currentPlanId] ?? 0;
  const remainingDays = getRemainingDays(user?.user?.subscriptionExpiresAt || user?.subscriptionExpiresAt);

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
              <div className="flex items-end mb-2 flex-wrap gap-2">
                <span className="text-4xl font-extrabold text-white capitalize">{displayPlanLabel}</span>
                <span className="text-lg text-slate-400 font-semibold">
                  ${currentPlan?.price || 0} / month
                </span>
                {currentPlanId !== 'free' && (
                  <span className="text-xs font-semibold text-slate-400 border border-[#1A2235] rounded-full px-2 py-0.5">30 days</span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                Subscription Expires: <span className="text-slate-300">{subscriptionExpiry || 'N/A'}</span>
                {subscriptionExpiryText && (
                  <span className="ml-2 text-amber-300">{subscriptionExpiryText}</span>
                )}
              </div>
              {currentPlanId !== 'free' && (
                <div className="mt-4">
                  <button
                    onClick={handleRenew}
                    disabled={processing !== null}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-[#7C5CFF] to-[#00D4FF] text-white shadow-glow-primary hover:shadow-glow-primary-hover transition-all"
                  >
                    {processing ? 'Processing...' : 'Renew (Add 30 days)'}
                  </button>
                </div>
              )}
              {user?.cancelAtPeriodEnd && (
                 <div className="mt-2 inline-block px-3 py-1 bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-bold rounded">
                   Cancels at Period End
                 </div>
              )}

              <div className="space-y-4 mt-6">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Daily Usage</h4>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">Uploads Remaining</span>
                    <span className="text-white font-mono">
                      {Math.max((user?.uploadLimitPerDay ?? 0) - (user?.uploadsUsedToday ?? 0), 0)} / {user?.uploadLimitPerDay ?? 0}
                    </span>
                  </div>
                  <div className="w-full bg-[#111827] rounded-full h-2 border border-[#1A2235]">
                    <div
                      className={`h-2 rounded-full ${user?.plan !== 'free' ? 'bg-[#00D4FF] shadow-[0_0_8px_rgba(0,212,255,0.6)]' : 'bg-[#7C5CFF]'}`}
                      style={{
                        width: `${Math.min(
                          ((Math.max((user?.uploadLimitPerDay ?? 0) - (user?.uploadsUsedToday ?? 0), 0)) /
                            (user?.uploadLimitPerDay ?? 1)) *
                            100,
                          100
                        )}%`
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold text-white mb-6">Available Plans</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {plans.map((plan, index) => {
                const isCurrentPlan = currentPlanId === plan.id;
                const planId = String(plan.id || '').toLowerCase();
                const isLowerPlan = isSubscriptionActive && currentRank > (planRank[planId] ?? 0);
                const hasDiscount = plan.discountPercentage > 0;
                const discountedPrice = hasDiscount ? plan.price * (1 - plan.discountPercentage / 100) : plan.price;

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
                    {plan.recommended && !hasDiscount && (
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-primary text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full shadow-glow-primary flex items-center">
                        <Sparkles className="h-3 w-3 mr-1" /> Popular
                      </div>
                    )}

                    {hasDiscount && (
                       <div className="absolute -top-3 right-4 bg-gradient-to-r from-[#FF4FD8] to-[#7C5CFF] text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full shadow-[0_0_15px_rgba(255,79,216,0.3)] flex items-center z-10">
                         Save {plan.discountPercentage}%
                       </div>
                    )}

                    <div className="mb-4">
                      <h3 className="text-lg font-bold text-white mb-1 capitalize">{plan.name}</h3>
                      <div className="flex items-baseline mb-2">
                        {hasDiscount ? (
                           <>
                             <span className="text-3xl font-extrabold text-white tracking-tight mr-2">${discountedPrice.toFixed(0)}</span>
                             <span className="text-sm font-bold text-slate-500 line-through decoration-red-500/50 mr-1">${plan.price}</span>
                             <span className="text-sm text-slate-400 font-medium">/mo</span>
                           </>
                        ) : (
                           <>
                             <span className="text-3xl font-extrabold text-white tracking-tight mr-1">${plan.price}</span>
                             <span className="text-sm text-slate-400 font-medium">/mo</span>
                           </>
                        )}
                        {planId !== 'free' && (
                          <span className="ml-2 text-[10px] font-semibold text-slate-400 border border-[#1A2235] rounded-full px-2 py-0.5">30 days</span>
                        )}
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
                      {isLowerPlan ? (
                        <div className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-400 text-center border border-[#1A2235] bg-[#111827]">
                          Included in your plan
                        </div>
                      ) : (
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
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <UpgradeOptionsModal
        open={upgradeModalOpen && !!pendingUpgradePlan}
        currentPlan={currentPlanId}
        targetPlan={pendingUpgradePlan || ''}
        remainingDays={remainingDays}
        creditDays={computeProrationDays(currentPlanId, pendingUpgradePlan || '', remainingDays)}
        onClose={() => setUpgradeModalOpen(false)}
        onBuy={() => {
          if (!pendingUpgradePlan) return;
          setUpgradeModalOpen(false);
          beginCheckout(pendingUpgradePlan);
        }}
        onConvert={async () => {
          if (!pendingUpgradePlan) return;
          try {
            await paymentService.convertPlan(pendingUpgradePlan);
            const userData = await authService.getMe();
            setUser(userData.data);
            setMessage({ text: 'Plan converted successfully using remaining days.', type: 'success' });
          } catch (err: any) {
            setMessage({ text: err.response?.data?.message || 'Failed to convert plan', type: 'error' });
          } finally {
            setUpgradeModalOpen(false);
          }
        }}
      />

    </DashboardLayout>
  );
}
