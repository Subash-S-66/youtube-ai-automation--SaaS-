'use client';

import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { CheckCircle2, ShieldAlert, Sparkles, Zap, RefreshCw } from 'lucide-react';
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

export default function PricingClient() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
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
             const limits = p.limits || {};
             const features = p.features || {};
             const adminFeatures = Array.isArray(p.featuresList)
               ? p.featuresList.map((item: unknown) => String(item || '').trim()).filter(Boolean)
               : [];

             const computedHighlights = [
               `${limits.daily_upload_limit || 0} video uploads per day`,
               `${limits.max_channels || 0} YouTube channels`,
               features.custom_media
                 ? `Custom media: ${limits.max_media_items || 0} items (${limits.max_video_items || 0} videos, ${limits.max_image_items || 0} images, ${limits.max_thumbnail_items || 0} thumbnails)`
                 : 'AI stock media library',
               features.custom_media
                 ? `Clip limits: ${limits.max_clip_length_seconds || 0}s per clip, ${limits.max_total_video_duration_seconds || 0}s total`
                 : 'Auto-generated media for every run',
             ];

             const capabilityFeatures = [
               features.voice_selection ? 'Premium AI voices' : '',
               features.scheduling ? 'Scheduling enabled' : '',
               features.story_mode ? 'Story Mode enabled' : '',
               features.cta ? 'Custom Call-to-Actions' : '',
               features.format_selection ? 'Multiple format selections' : '',
               features.template_customization ? 'Subtitle font & color control' : '',
             ].filter(Boolean);

             const dynamicFeatures = Array.from(new Set([...computedHighlights, ...adminFeatures, ...capabilityFeatures]));

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
    setUpgrading(planId);
    setMessage(null);
    try {
      const res = await paymentService.createCheckoutSession(planId);
      const order = res?.data;
      if (order?.short_url) {
        window.location.assign(order.short_url);
        return;
      }
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
            setUpgrading(null);
          }
        },
        onDismiss: () => {
          setUpgrading(null);
        },
        onFailure: (error) => {
          setMessage({ text: error.message || 'Payment failed', type: 'error' });
          setUpgrading(null);
        },
      });
    } catch (err: any) {
      // Handle the generic placeholder case or error cleanly
      setMessage({ text: err.response?.data?.message || 'Upgrade API not fully configured for this plan yet.', type: 'error' });
      setUpgrading(null);
    } finally {
      // handled by modal callbacks
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
      <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-[#7C5CFF] animate-spin" />
      </div>
    );
  }

  const currentPlanId = (user?.isBetaMode ? 'free' : (user?.plan || 'free')).toLowerCase();
  const isSubscriptionActive = (user?.subscriptionStatus || user?.user?.subscriptionStatus) === 'active';
  const planRank: Record<string, number> = { free: 0, basic: 1, pro: 2, premium: 4 };
  const currentRank = planRank[currentPlanId] ?? 0;
  const remainingDays = getRemainingDays(user?.user?.subscriptionExpiresAt || user?.subscriptionExpiresAt);

  return (
    <section itemScope itemType="https://schema.org/WebPage">
      <DashboardLayout user={user}>
        <div className="max-w-none mx-auto py-12 px-6 sm:px-10 lg:px-16 xl:px-24 2xl:px-32">

          {/* Header */}
          <div className="text-center max-w-3xl mx-auto mb-16">
            <m.h1
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-slate-400 mb-4"
            >
              Upgrade your creative flow
            </m.h1>
            <m.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg text-slate-400"
            >
              Choose the perfect plan to scale your Clip Forge workflow and generate more shorts every day.
            </m.p>
          </div>

          {message && (
            <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("p-4 mb-8 rounded-xl border flex items-center text-sm font-medium", message.type === 'error' ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-green-500/10 border-green-500/20 text-green-400")}>
              <ShieldAlert className="h-5 w-5 mr-3 flex-shrink-0" />
              {message.text}
            </m.div>
          )}

          {/* Pricing Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
            {plans.map((plan, index) => {
              const isCurrentPlan = currentPlanId === plan.id;
              const planId = String(plan.id || '').toLowerCase();
              const isLowerPlan = isSubscriptionActive && currentRank > (planRank[planId] ?? 0);
              const hasDiscount = plan.discountPercentage > 0;
              const discountedPrice = hasDiscount ? plan.price * (1 - plan.discountPercentage / 100) : plan.price;

              return (
                <m.div
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
                      {planId !== 'free' && (
                        <span className="ml-2 text-xs font-semibold text-slate-400 border border-[#1A2235] rounded-full px-2 py-0.5">30 days</span>
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
                    {isLowerPlan ? (
                      <div className="w-full py-3.5 px-4 rounded-xl text-xs font-semibold text-slate-400 text-center border border-[#1A2235] bg-[#111827]">
                        Included in your plan
                      </div>
                    ) : (
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
                    )}
                  </div>
                </m.div>
              );
            })}
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

        </div>
      </DashboardLayout>
    </section>
  );
}
