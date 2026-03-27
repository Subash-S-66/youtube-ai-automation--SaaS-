"use client";

import { useEffect, useState, useRef, RefObject } from 'react';
import Link from 'next/link';
import { Users, CreditCard, RefreshCw, Bell, MonitorPlay, Settings, CheckCircle, MessageSquare } from 'lucide-react';
import dynamic from 'next/dynamic';
import { adminService } from '../../services/adminService';
const AppModal = dynamic(() => import('../../components/ui/AppModal'), { ssr: false });
import { AppModalType } from '../../components/ui/AppModal';
import { cn } from '../../lib/utils';

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalActiveSubscriptions: number;
  totalEarnings: number;
  jobs: {
    total: number;
    successful: number;
    failed: number;
    successRate: string;
    failureRate: string;
  };
}

interface UserSummary {
  _id: string;
  email: string;
  plan: string;
  uploadsUsedToday: number;
  uploadsOnHold: number;
  subscriptionExpiresAt?: string;
}

export default function AdminDashboard() {
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userSearch, setUserSearch] = useState('');

  // Tools forms
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifyType, setNotifyType] = useState('info');
  const [notifyTargetPlans, setNotifyTargetPlans] = useState<string[]>(['free', 'basic', 'pro', 'premium']);
  const [notifySendEmail, setNotifySendEmail] = useState(false);
  const [notifying, setNotifying] = useState(false);

  // Plans Config State
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [bannerMessage, setBannerMessage] = useState('');
  const [bannerActive, setBannerActive] = useState(true);
  const [bannerType, setBannerType] = useState('info-blue');
  const [bannerStart, setBannerStart] = useState('');
  const [bannerEnd, setBannerEnd] = useState('');
  const [bannering, setBannering] = useState(false);
  const [togglingBanner, setTogglingBanner] = useState(false);
  const bannerStartRef = useRef<HTMLInputElement | null>(null);
  const bannerEndRef = useRef<HTMLInputElement | null>(null);
  const [betaMode, setBetaMode] = useState(false);
  const [pipelineRunner, setPipelineRunner] = useState<'local' | 'azure'>('local');
  const [updatingConfig, setUpdatingConfig] = useState(false);
  const [planValueMap, setPlanValueMap] = useState({ free: 0, basic: 1, pro: 2, premium: 4 });
  const [savingProration, setSavingProration] = useState(false);
  const [savingPipelineRunner, setSavingPipelineRunner] = useState(false);
  const [planDrafts, setPlanDrafts] = useState<any[]>([]);
  const [savingPlans, setSavingPlans] = useState(false);

  const openPicker = (ref: RefObject<HTMLInputElement | null>) => {
    if (!ref.current) return;
    const input = ref.current as HTMLInputElement & { showPicker?: () => void };
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }
    input.focus();
  };

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

  const setBannerWithCompatibility = async (payload: {
    message: string;
    isActive: boolean;
    type: string;
    startAt?: string | null;
    endAt?: string | null;
  }) => {
    try {
      return await adminService.setGlobalBanner(payload);
    } catch (err: any) {
      const errMessage = err?.response?.data?.message || '';
      const needsLegacyType = typeof errMessage === 'string' &&
        errMessage.includes('Invalid option: expected one of "info"|"warning"|"critical"');

      if (!needsLegacyType) {
        throw err;
      }

      const legacyType = payload.type.includes('-') ? payload.type.split('-')[0] : payload.type;
      return await adminService.setGlobalBanner({ ...payload, type: legacyType });
    }
  };

  const handleCreateNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifyTitle || !notifyMessage || notifyTargetPlans.length === 0) return;
    setNotifying(true);
    try {
      await adminService.createNotification({
        title: notifyTitle,
        message: notifyMessage,
        type: notifyType,
        targetPlans: notifyTargetPlans,
        sendEmail: notifySendEmail
      });
      alert('Notification sent successfully!');
      setNotifyTitle('');
      setNotifyMessage('');
    } catch (err) {
      console.error(err);
      alert('Failed to send notification.');
    } finally {
      setNotifying(false);
    }
  };

  const handleSetBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bannerMessage.trim()) return;
    setBannering(true);
    try {
      await setBannerWithCompatibility({
        message: bannerMessage.trim(),
        // Updating banner always turns it back on automatically.
        isActive: true,
        type: bannerType,
        startAt: bannerStart ? new Date(bannerStart).toISOString() : null,
        endAt: bannerEnd ? new Date(bannerEnd).toISOString() : null
      });
      setBannerActive(true);
      alert('Banner updated successfully!');
    } catch (err) {
      console.error(err);
      const message = (err as any)?.response?.data?.message || 'Failed to update banner.';
      alert(message);
    } finally {
      setBannering(false);
    }
  };

  const handleBannerActiveToggle = async (nextActive: boolean) => {
    setBannerActive(nextActive);
    if (nextActive) {
      return;
    }

    setTogglingBanner(true);
    try {
      await setBannerWithCompatibility({
        message: bannerMessage.trim() || ' ',
        isActive: false,
        type: bannerType,
        startAt: bannerStart ? new Date(bannerStart).toISOString() : null,
        endAt: bannerEnd ? new Date(bannerEnd).toISOString() : null
      });
      alert('Banner turned off.');
    } catch (err) {
      setBannerActive(true);
      const message = (err as any)?.response?.data?.message || 'Failed to turn off banner.';
      alert(message);
    } finally {
      setTogglingBanner(false);
    }
  };

  const executeUpdateConfig = async (newBetaMode: boolean) => {
    setUpdatingConfig(true);
    try {
      await adminService.updateSystemConfig({ betaMode: newBetaMode, planValueMap, pipelineRunner });
      setBetaMode(newBetaMode);
      setModalConfig({
         isOpen: true,
         title: 'Success',
         description: `Beta Mode ${newBetaMode ? 'ENABLED' : 'DISABLED'} successfully.`,
         type: 'success',
         confirmText: 'OK',
         onConfirm: () => window.location.reload()
      });
    } catch (err) {
      console.error(err);
      setModalConfig({
         isOpen: true,
         title: 'Error',
         description: 'Failed to update system config.',
         type: 'error',
         confirmText: 'Dismiss',
         onConfirm: () => setModalConfig(prev => ({...prev, isOpen: false}))
      });
    } finally {
      setUpdatingConfig(false);
    }
  };

  const handleSaveProration = async () => {
    setSavingProration(true);
    try {
      await adminService.updateSystemConfig({ betaMode, planValueMap, pipelineRunner });
      setModalConfig({
        isOpen: true,
        title: 'Proration Updated',
        description: 'Plan conversion ratios saved successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update proration settings.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingProration(false);
    }
  };

  const handleSavePipelineRunner = async () => {
    setSavingPipelineRunner(true);
    try {
      await adminService.updateSystemConfig({ betaMode, planValueMap, pipelineRunner });
      setModalConfig({
        isOpen: true,
        title: 'Pipeline Runner Updated',
        description: `Pipeline runner switched to ${pipelineRunner === 'local' ? 'Local Worker' : 'Azure Container Apps'}.`,
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update pipeline runner.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingPipelineRunner(false);
    }
  };

  const handleUpdateConfig = (newBetaMode: boolean) => {
    if (newBetaMode) {
      setModalConfig({
         isOpen: true,
         title: 'Enable Beta Mode',
         description: 'Are you ABSOLUTELY sure you want to enable Beta Mode? This will instantly grant ALL free users BASIC privileges globally.',
         type: 'warning',
         confirmText: 'Enable globally',
         cancelText: 'Cancel',
         onConfirm: () => {
             setModalConfig(prev => ({...prev, isOpen: false}));
             executeUpdateConfig(newBetaMode);
         },
         onCancel: () => setModalConfig(prev => ({...prev, isOpen: false}))
      });
    } else {
      setModalConfig({
         isOpen: true,
         title: 'Disable Beta Mode',
         description: 'Are you sure you want to disable Beta Mode? Users will instantly revert to their normal plans.',
         type: 'warning',
         confirmText: 'Disable',
         cancelText: 'Cancel',
         onConfirm: () => {
             setModalConfig(prev => ({...prev, isOpen: false}));
             executeUpdateConfig(newBetaMode);
         },
         onCancel: () => setModalConfig(prev => ({...prev, isOpen: false}))
      });
    }
  };

  const handleTogglePlan = (plan: string) => {
    if (notifyTargetPlans.includes(plan)) {
      setNotifyTargetPlans(notifyTargetPlans.filter(p => p !== plan));
    } else {
      setNotifyTargetPlans([...notifyTargetPlans, plan]);
    }
  };

  const handlePlanChange = (planId: string, updates: any) => {
    setPlanDrafts(prev => prev.map(p => p._id === planId ? { ...p, ...updates } : p));
  };

  const getPlanPayload = (plan: any) => ({
    is_active: plan.is_active,
    price: Number(plan.price),
    discountPercentage: Number(plan.discountPercentage || 0),
    priority_weight: Number(plan.priority_weight),
    featuresList: Array.isArray(plan.featuresList) ? plan.featuresList : [],
    limits: {
      max_channels: Number(plan.limits?.max_channels),
      daily_upload_limit: Number(plan.limits?.daily_upload_limit),
    },
    features: {
      voice_selection: !!plan.features?.voice_selection,
      scheduling: !!plan.features?.scheduling,
      multi_channel: !!plan.features?.multi_channel,
      story_mode: !!plan.features?.story_mode,
      cta: !!plan.features?.cta,
      format_selection: !!plan.features?.format_selection,
      template_customization: !!plan.features?.template_customization,
      custom_media: !!plan.features?.custom_media,
    },
  });

  const hasPlanChanges = () => {
    if (!plans.length || !planDrafts.length) return false;
    return planDrafts.some(draft => {
      const original = plans.find(p => p._id === draft._id);
      if (!original) return true;
      return JSON.stringify(getPlanPayload(original)) !== JSON.stringify(getPlanPayload(draft));
    });
  };

  const handleSavePlans = async () => {
    setSavingPlans(true);
    try {
      const { planService } = await import('../../services/planService');
      const updates = planDrafts
        .map(draft => {
          const original = plans.find(p => p._id === draft._id);
          if (!original) return { id: draft._id, data: getPlanPayload(draft) };
          const draftPayload = getPlanPayload(draft);
          const originalPayload = getPlanPayload(original);
          if (JSON.stringify(draftPayload) === JSON.stringify(originalPayload)) return null;
          return { id: draft._id, data: draftPayload };
        })
        .filter(Boolean) as Array<{ id: string; data: any }>;

      for (const update of updates) {
        await planService.updatePlan(update.id, update.data);
      }

      setPlans(planDrafts);
      setModalConfig({
        isOpen: true,
        title: 'Plans Updated',
        description: updates.length ? 'Plans configuration saved successfully.' : 'No changes to save.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update plans',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingPlans(false);
    }
  };

const handleDeleteUser = () => {
    if (!selectedUserId) return;

    setModalConfig({
       isOpen: true,
       title: 'Delete User',
       description: 'Are you absolutely sure you want to delete this user? This action cannot be undone.',
       type: 'error',
       confirmText: 'Delete Permanently',
       cancelText: 'Cancel',
       onConfirm: async () => {
           setModalConfig(prev => ({...prev, isOpen: false}));
           try {
             await adminService.deleteUser(selectedUserId);
             setModalConfig({
                isOpen: true,
                title: 'Success',
                description: 'User deleted successfully.',
                type: 'success',
                confirmText: 'OK',
                onConfirm: () => setModalConfig(prev => ({...prev, isOpen: false}))
             });
             setSelectedUserId(null);
             const usersData = await adminService.getUsers();
             setUsers(usersData.data);
           } catch (err) {
             console.error(err);
             setModalConfig({
                isOpen: true,
                title: 'Error',
                description: 'Failed to delete user.',
                type: 'error',
                confirmText: 'Dismiss',
                onConfirm: () => setModalConfig(prev => ({...prev, isOpen: false}))
             });
           }
       },
       onCancel: () => setModalConfig(prev => ({...prev, isOpen: false}))
    });
  };

  useEffect(() => {
    let isMounted = true;
    const initAdmin = async () => {
      try {
        if (!isMounted) return;

        setDashboardLoading(true);

        // Start loading the heavy API endpoints without blocking the initial UI completely
        Promise.allSettled([
          adminService.getStats(),
          adminService.getUsers(userPage, 10, userSearch),
          adminService.getSystemConfig(),
          adminService.getGlobalBanner(),
          import('../../services/planService').then(m => m.planService.getAdminPlans()),
        ]).then((results) => {
          if (!isMounted) return;
          const [statsRes, usersRes, configRes, bannerRes, plansRes] = results;

          if (statsRes.status === 'fulfilled' && statsRes.value?.success) setStats(statsRes.value.data);
          if (usersRes.status === 'fulfilled' && usersRes.value?.success) {
            setUsers(usersRes.value.data);
            setUserTotalPages(usersRes.value.pagination?.pages || 1);
          }

          if (configRes.status === 'fulfilled' && configRes.value?.success && configRes.value.data) {
            setBetaMode(configRes.value.data.betaMode);
            if (configRes.value.data.pipelineRunner) {
              setPipelineRunner(configRes.value.data.pipelineRunner);
            }
            if (configRes.value.data.planValueMap) {
              setPlanValueMap({
                free: Number(configRes.value.data.planValueMap.free ?? 0),
                basic: Number(configRes.value.data.planValueMap.basic ?? 1),
                pro: Number(configRes.value.data.planValueMap.pro ?? 2),
                premium: Number(configRes.value.data.planValueMap.premium ?? 4),
              });
            }
          }

          if (bannerRes.status === 'fulfilled' && bannerRes.value?.success && bannerRes.value.data) {
            const bd = bannerRes.value.data;
            setBannerMessage(bd.message || '');
            setBannerActive(!!bd.isActive);
            setBannerType(bd.type || 'info-blue');
            setBannerStart(bd.startAt ? new Date(bd.startAt).toISOString().slice(0, 16) : '');
            setBannerEnd(bd.endAt ? new Date(bd.endAt).toISOString().slice(0, 16) : '');
          } else {
            setBannerActive(false);
          }

          if (plansRes.status === 'fulfilled' && plansRes.value?.success) {
            setPlans(plansRes.value.data);
            setPlanDrafts(plansRes.value.data);
          }
          setDashboardLoading(false);
        });

      } catch (error) {
        console.error("Admin init error", error);
      } finally {
        if (isMounted) {
          setDashboardLoading(false);
        }
      }
    };
    initAdmin();
    return () => {
      isMounted = false;
    };
  }, [userPage, userSearch]);

  return (
    <>
      <div className="max-w-7xl mx-auto py-8">
        <div className="space-y-8">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">Admin Panel</h1>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/admin/users"
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[#1A2235] bg-[#111827] text-slate-200 hover:text-white hover:border-[#7C5CFF]/60 transition-colors text-sm font-semibold"
            >
              <Users className="h-4 w-4 text-[#00D4FF]" />
              Users Directory
            </Link>
            <Link
              href="/admin/tickets"
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[#1A2235] bg-[#111827] text-slate-200 hover:text-white hover:border-[#7C5CFF]/60 transition-colors text-sm font-semibold"
            >
              <MessageSquare className="h-4 w-4 text-[#00D4FF]" />
              Support Tickets
            </Link>
          </div>

          {/* Control Tools */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              {/* Notification Sender */}
              <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
                <div className="flex items-center mb-6">
                  <Bell className="h-5 w-5 text-[#7C5CFF] mr-2" />
                  <h2 className="text-xl font-bold text-white">Send Notification</h2>
                </div>
                <form onSubmit={handleCreateNotification} className="space-y-4">
                  <div>
                    <label htmlFor="notify-title" className="block text-xs text-slate-400 mb-1">Title</label>
                    <input id="notify-title" type="text" placeholder="Title" value={notifyTitle} onChange={(e) => setNotifyTitle(e.target.value)} required className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none" />
                  </div>
                  <div>
                    <label htmlFor="notify-message" className="block text-xs text-slate-400 mb-1">Message</label>
                    <textarea id="notify-message" placeholder="Message" value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} required rows={3} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none resize-none"></textarea>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label htmlFor="notify-type" className="block text-xs text-slate-400 mb-1">Type</label>
                      <select id="notify-type" value={notifyType} onChange={(e) => setNotifyType(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none">
                        <option value="info">Info</option>
                        <option value="warning">Warning</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-2">Target Plans</p>
                    <div className="flex gap-2 flex-wrap">
                      {['free', 'basic', 'pro', 'premium'].map(plan => (
                        <button key={plan} type="button" onClick={() => handleTogglePlan(plan)} className={cn("px-3 py-1 text-xs font-bold rounded-full border transition-colors", notifyTargetPlans.includes(plan) ? "bg-[#7C5CFF]/20 text-[#7C5CFF] border-[#7C5CFF]/50" : "bg-transparent text-slate-400 border-[#1A2235] hover:border-slate-500")}> 
                          {plan.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label htmlFor="notify-send-email" className="flex items-center mt-2 cursor-pointer">
                    <input id="notify-send-email" type="checkbox" checked={notifySendEmail} onChange={(e) => setNotifySendEmail(e.target.checked)} className="rounded border-slate-700 bg-slate-800 text-[#7C5CFF] focus:ring-[#7C5CFF]" />
                    <span className="ml-2 text-sm text-slate-300">Also send via Email Queue</span>
                  </label>
                  <button type="submit" disabled={notifying} className="w-full py-2 bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white font-bold rounded-lg transition-colors flex justify-center items-center">
                    {notifying ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Send Broadcast'}
                  </button>
                </form>
              </div>

              {/* Global Banner */}
              <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
                <div className="flex items-center mb-6">
                  <MonitorPlay className="h-5 w-5 text-[#00D4FF] mr-2" />
                  <h2 className="text-xl font-bold text-white">Global Banner</h2>
                </div>
                <form onSubmit={handleSetBanner} className="space-y-4">
                  <div>
                    <label htmlFor="banner-message" className="block text-xs text-slate-400 mb-1">Banner Message</label>
                    <input id="banner-message" type="text" placeholder="Banner Message (Max 200 chars)" value={bannerMessage} onChange={(e) => setBannerMessage(e.target.value)} required={bannerActive} maxLength={200} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#00D4FF] focus:outline-none" />
                  </div>
                  <div>
                    <label htmlFor="banner-type" className="block text-xs text-slate-400 mb-1">Banner Color</label>
                    <select id="banner-type" value={bannerType} onChange={(e) => setBannerType(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#00D4FF] focus:outline-none">
                      <option value="info-blue">Info (Blue)</option>
                      <option value="info-cyan">Info (Cyan)</option>
                      <option value="info-green">Info (Green)</option>
                      <option value="info-purple">Info (Purple)</option>
                      <option value="warning-amber">Warning (Amber)</option>
                      <option value="warning-gold">Warning (Gold)</option>
                      <option value="critical-red">Critical (Red)</option>
                      <option value="critical-rose">Critical (Rose)</option>
                    </select>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <label htmlFor="banner-start" className="block text-xs text-slate-400 mb-1">Start At (Optional)</label>
                      <div className="relative">
                        <input id="banner-start" ref={bannerStartRef} type="datetime-local" value={bannerStart} onChange={(e) => setBannerStart(e.target.value)} className="calendar-white w-full bg-[#0B0F1A] text-white px-3 py-2 pr-10 rounded-lg border border-[#1A2235] focus:border-[#00D4FF] focus:outline-none [color-scheme:dark]" />
                        <button type="button" aria-label="Open start date picker" onClick={() => openPicker(bannerStartRef)} className="absolute right-1 top-1/2 -translate-y-1/2 text-white w-9 h-9 flex items-center justify-center rounded-md hover:bg-white/10">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label htmlFor="banner-end" className="block text-xs text-slate-400 mb-1">End At (Optional)</label>
                      <div className="relative">
                        <input id="banner-end" ref={bannerEndRef} type="datetime-local" value={bannerEnd} onChange={(e) => setBannerEnd(e.target.value)} className="calendar-white w-full bg-[#0B0F1A] text-white px-3 py-2 pr-10 rounded-lg border border-[#1A2235] focus:border-[#00D4FF] focus:outline-none [color-scheme:dark]" />
                        <button type="button" aria-label="Open end date picker" onClick={() => openPicker(bannerEndRef)} className="absolute right-1 top-1/2 -translate-y-1/2 text-white w-9 h-9 flex items-center justify-center rounded-md hover:bg-white/10">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <label className="flex items-center justify-between cursor-pointer bg-[#0B0F1A] border border-[#1A2235] rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Banner Active</p>
                      <p className="text-xs text-slate-400">Turn on/off the global banner</p>
                    </div>
                    <span className="relative inline-flex items-center">
                    <input id="banner-active" type="checkbox" className="sr-only peer" checked={bannerActive} disabled={togglingBanner || bannering} onChange={(e) => handleBannerActiveToggle(e.target.checked)} />
                      <span className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00D4FF]"></span>
                    </span>
                  </label>
                  <button type="submit" disabled={bannering || togglingBanner} className="w-full py-2 bg-[#00D4FF] hover:bg-[#00b5d8] text-black font-bold rounded-lg transition-colors flex justify-center items-center mt-auto">
                    {bannering ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Update Banner'}
                  </button>
                </form>
              </div>

              {/* System Config (Beta Mode) */}
              <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
                <div className="flex items-center mb-6">
                  <Settings className="h-5 w-5 text-slate-300 mr-2" />
                  <h2 className="text-xl font-bold text-white">System Config</h2>
                </div>
                <div className="p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-white font-bold">Beta Mode</p>
                    <p className="text-sm text-slate-400">When enabled, all free users temporarily receive "Basic" plan limits. Does not modify their database record.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input id="beta-mode-toggle" aria-label="Toggle Beta Mode" type="checkbox" className="sr-only peer" checked={betaMode} onChange={(e) => handleUpdateConfig(e.target.checked)} disabled={updatingConfig} />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#7C5CFF]"></div>
                  </label>
                </div>
                <div className="mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl">
                  <p className="text-sm font-semibold text-white mb-2">Plan Conversion Ratios</p>
                  <p className="text-xs text-slate-400 mb-3">Higher value = more days. Example: Basic 1, Pro 2, Premium 4 means 2 Basic days = 1 Pro day, 4 Basic days = 1 Premium day.</p>
                  <div className="grid grid-cols-2 gap-3">
                    {(['free', 'basic', 'pro', 'premium'] as const).map((key) => (
                      <div key={key}>
                        <label className="text-xs text-slate-400 block mb-1">{key.toUpperCase()} Value</label>
                        <input id={`plan-value-map-${key}`} aria-label="Plan Value Map"
                          type="number"
                          min="0"
                          step="0.1"
                          value={(planValueMap as any)[key]}
                          onChange={(e) => setPlanValueMap(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveProration}
                    disabled={savingProration}
                    className="mt-3 w-full py-2 bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingProration ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Proration Settings'}
                  </button>
                </div>
                <div className="mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl">
                  <p className="text-sm font-semibold text-white mb-2">Pipeline Runner</p>
                  <p className="text-xs text-slate-400 mb-3">Choose where pipeline jobs execute. GitHub Workspace runs in GitHub Actions. Azure runs in Container Apps Jobs.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Runner</label>
                      <select
                        id="pipeline-runner-select"
                        aria-label="Pipeline Runner"
                        value={pipelineRunner}
                        onChange={(e) => setPipelineRunner(e.target.value as 'local' | 'azure')}
                        className="w-full bg-[#111827] text-white px-2 py-2 rounded border border-[#1A2235]"
                      >
                        <option value="local">Local Worker</option>
                        <option value="azure">Azure Container Apps</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleSavePipelineRunner}
                        disabled={savingPipelineRunner}
                        className="w-full py-2 bg-[#00D4FF] hover:bg-[#00b5d8] text-black font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {savingPipelineRunner ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Pipeline Runner'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Dynamic Plans Control */}
            <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <Settings className="h-5 w-5 text-[#7C5CFF] mr-2" />
                  <h2 className="text-xl font-bold text-white">Plans Configuration</h2>
                </div>
                <button
                  type="button"
                  onClick={handleSavePlans}
                  disabled={savingPlans || !hasPlanChanges()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#7C5CFF] text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingPlans ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
              <div className="space-y-4">
                {planDrafts.map(plan => (
                  <div key={plan._id} className="bg-[#0B0F1A] border border-[#1A2235] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-white capitalize">{plan.name}</h3>
                      <label className="flex items-center cursor-pointer">
                        <span className="mr-2 text-xs text-slate-400">Active</span>
                        <div className="relative inline-flex items-center">
                          <input aria-label={`Toggle active for ${plan.name}`} type="checkbox" className="sr-only peer" checked={plan.is_active} onChange={(e) => handlePlanChange(plan._id, { is_active: e.target.checked })} />
                          <div className="w-9 h-5 bg-[#1A2235] rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#7C5CFF]"></div>
                        </div>
                      </label>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Price</label>
                        <input aria-label={`Price for ${plan.name}`} type="number" value={plan.price} onChange={(e) => handlePlanChange(plan._id, { price: Number(e.target.value) })} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Discount %</label>
                        <input aria-label={`Discount percentage for ${plan.name}`} type="number" min="0" max="100" value={plan.discountPercentage || 0} onChange={(e) => handlePlanChange(plan._id, { discountPercentage: Number(e.target.value) })} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Priority Weight</label>
                        <input aria-label={`Priority weight for ${plan.name}`} type="number" value={plan.priority_weight} onChange={(e) => handlePlanChange(plan._id, { priority_weight: Number(e.target.value) })} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                      </div>
                    </div>

                    <div className="mb-4">
                      <label className="text-xs text-slate-400 block mb-1">Features List (Comma separated for display)</label>
                      <input aria-label={`Features list for ${plan.name}`} type="text" value={(plan.featuresList || []).join(', ')} onChange={(e) => handlePlanChange(plan._id, { featuresList: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="E.g., 100 uploads, Fast AI, 24/7 Support" className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Max Channels</label>
                        <input aria-label={`Max channels for ${plan.name}`} type="number" value={plan.limits?.max_channels} onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, max_channels: Number(e.target.value) }})} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Daily Uploads</label>
                        <input aria-label={`Daily upload limit for ${plan.name}`} type="number" value={plan.limits?.daily_upload_limit} onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, daily_upload_limit: Number(e.target.value) }})} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="flex items-center cursor-pointer">
                        <input aria-label={`Toggle voice_selection feature for ${plan.name}`} type="checkbox" checked={plan.features?.voice_selection} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, voice_selection: e.target.checked }})} className="mr-2" />
                        <span className="text-xs text-slate-300">Voice Selection</span>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input aria-label={`Toggle scheduling feature for ${plan.name}`} type="checkbox" checked={plan.features?.scheduling} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, scheduling: e.target.checked }})} className="mr-2" />
                        <span className="text-xs text-slate-300">Scheduling</span>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input aria-label={`Toggle multi_channel feature for ${plan.name}`} type="checkbox" checked={plan.features?.multi_channel} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, multi_channel: e.target.checked }})} className="mr-2" />
                        <span className="text-xs text-slate-300">Multi Channel</span>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input aria-label={`Toggle story_mode feature for ${plan.name}`} type="checkbox" checked={plan.features?.story_mode} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, story_mode: e.target.checked }})} className="mr-2" />
                        <span className="text-xs text-slate-300">Story Mode</span>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input aria-label={`Toggle cta feature for ${plan.name}`} type="checkbox" checked={plan.features?.cta} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, cta: e.target.checked }})} className="mr-2" />
                        <span className="text-xs text-slate-300">Ending CTA</span>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input aria-label={`Toggle format_selection feature for ${plan.name}`} type="checkbox" checked={plan.features?.format_selection} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, format_selection: e.target.checked }})} className="mr-2" />
                        <span className="text-xs text-slate-300">Format Selection</span>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input aria-label={`Toggle template_customization feature for ${plan.name}`} type="checkbox" checked={plan.features?.template_customization} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, template_customization: e.target.checked }})} className="mr-2" />
                        <span className="text-xs text-slate-300">Subtitle Style (Font/Color)</span>
                      </label>
                      <label className="flex items-center cursor-pointer">
                        <input aria-label={`Toggle custom_media feature for ${plan.name}`} type="checkbox" checked={plan.features?.custom_media} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, custom_media: e.target.checked }})} className="mr-2" />
                        <span className="text-xs text-slate-300">Custom Media Library</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleSavePlans}
                disabled={savingPlans || !hasPlanChanges()}
                className="mt-4 w-full py-2 bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingPlans ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Plan Changes'}
              </button>
            </div>

          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl flex items-center shadow-lg">
              <div className="p-4 rounded-xl bg-[#7C5CFF]/10 text-[#7C5CFF] mr-4"><Users className="h-6 w-6" /></div>
              <div><p className="text-slate-400 text-sm font-medium">Total Users</p><p className="text-2xl font-bold text-white">{dashboardLoading ? '...' : (stats?.totalUsers || 0)}</p></div>
            </div>
            <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl flex items-center shadow-lg">
              <div className="p-4 rounded-xl bg-[#00D4FF]/10 text-[#00D4FF] mr-4"><CreditCard className="h-6 w-6" /></div>
              <div><p className="text-slate-400 text-sm font-medium">Active Subscriptions</p><p className="text-2xl font-bold text-white">{dashboardLoading ? '...' : (stats?.totalActiveSubscriptions || 0)}</p></div>
            </div>
            <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl flex items-center shadow-lg">
              <div className="p-4 rounded-xl bg-green-500/10 text-green-500 mr-4"><CheckCircle className="h-6 w-6" /></div>
              <div><p className="text-slate-400 text-sm font-medium">Success Rate</p><p className="text-2xl font-bold text-white">{dashboardLoading ? '...' : (stats?.jobs?.successRate || '0%')}</p></div>
            </div>
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
