"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, CreditCard, DollarSign, RefreshCw, ChevronLeft, Search, Save, History as HistoryIcon, FileText, Bell, MonitorPlay, Trash2, Settings, CheckCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { adminService } from '../../services/adminService';
import { authService } from '../../services/authService';
import DashboardLayout from '../../components/layout/DashboardLayout';
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

interface UserDetails {
  user: any;
  jobs: any[];
  prompts: any[];
}

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Edit forms
  const [editPlan, setEditPlan] = useState('free');
  const [editExpiry, setEditExpiry] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  // Tools forms
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifyType, setNotifyType] = useState('info');
  const [notifyTargetPlans, setNotifyTargetPlans] = useState<string[]>(['free', 'basic', 'pro', 'premium']);
  const [notifySendEmail, setNotifySendEmail] = useState(false);
  const [notifying, setNotifying] = useState(false);

  // Plans Config State
  const [plans, setPlans] = useState<any[]>([]);

  const [bannerMessage, setBannerMessage] = useState('');
  const [bannerActive, setBannerActive] = useState(true);
  const [bannerType, setBannerType] = useState('info-blue');
  const [bannerStart, setBannerStart] = useState('');
  const [bannerEnd, setBannerEnd] = useState('');
  const [bannering, setBannering] = useState(false);
  const [togglingBanner, setTogglingBanner] = useState(false);

  const [betaMode, setBetaMode] = useState(false);
  const [updatingConfig, setUpdatingConfig] = useState(false);
  const [planLimits, setPlanLimits] = useState({ free: 2, basic: 10, pro: 25, premium: 100 });
  const [savingPlanLimits, setSavingPlanLimits] = useState(false);

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
        message: bannerMessage.trim() || 'Banner disabled',
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
      await adminService.updateSystemConfig({ betaMode: newBetaMode });
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

  const handleSavePlanLimits = async () => {
    setSavingPlanLimits(true);
    try {
      await adminService.updateSystemConfig({
        betaMode,
        planLimits: {
          free: Number(planLimits.free),
          basic: Number(planLimits.basic),
          pro: Number(planLimits.pro),
          premium: Number(planLimits.premium),
        },
      });
      setModalConfig({
        isOpen: true,
        title: 'Success',
        description: 'Plan limits updated successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err) {
      console.error(err);
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: 'Failed to update plan limits.',
        type: 'error',
        confirmText: 'Dismiss',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingPlanLimits(false);
    }
  };

  const handleTogglePlan = (plan: string) => {
    if (notifyTargetPlans.includes(plan)) {
      setNotifyTargetPlans(notifyTargetPlans.filter(p => p !== plan));
    } else {
      setNotifyTargetPlans([...notifyTargetPlans, plan]);
    }
  };

  const handlePlanChange = async (planId: string, updates: any) => {
      try {
          const { planService } = await import('../../services/planService');
          await planService.updatePlan(planId, updates);

          setPlans(prev => prev.map(p => p._id === planId ? { ...p, ...updates } : p));
          setModalConfig({
              isOpen: true,
              title: 'Plan Updated',
              description: 'The plan configuration has been successfully updated.',
              type: 'success',
              confirmText: 'OK',
              onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
          });
      } catch (err: any) {
          setModalConfig({
              isOpen: true,
              title: 'Error',
              description: err.response?.data?.message || 'Failed to update plan',
              type: 'error',
              confirmText: 'OK',
              onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
          });
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
        const me = await authService.getMe();
        if (!me?.data?.user || me.data.user.role !== 'admin') {
          if (isMounted) router.replace('/dashboard');
          return;
        }

        if (!isMounted) return;

        setCurrentUser({ ...me.data.user, plan: me.data.plan, displayPlan: me.data.displayPlan, isBetaMode: me.data.isBetaMode });
        setLoading(false);
        setDashboardLoading(true);

        // Start loading the heavy API endpoints without blocking the initial UI completely
        Promise.allSettled([
          adminService.getStats(),
          adminService.getUsers(userPage, 10, userSearch),
          adminService.getSystemConfig(),
          adminService.getGlobalBanner(),
          import('../../services/planService').then(m => m.planService.getPlans()),
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
              if (configRes.value.data.planLimits) {
                setPlanLimits(configRes.value.data.planLimits);
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
           }
           setDashboardLoading(false);
        });

      } catch (error) {
        console.error("Admin init error", error);
        if (isMounted) router.replace('/login');
      } finally {
        if (isMounted) {
          setLoading(false);
          setDashboardLoading(false);
        }
      }
    };
    initAdmin();
    return () => { isMounted = false; };
  }, [router, userPage, userSearch]);

  const handleUserSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserSearch(e.target.value);
    setUserPage(1); // Reset to first page on new search
  };

  const loadUserDetails = async (id: string) => {
    try {
      setSelectedUserId(id);
      setUserDetails(null);
      const data = await adminService.getUserDetails(id);
      setUserDetails(data.data);
      setEditPlan(data.data.user.plan);
      if (data.data.user.subscriptionExpiresAt) {
        setEditExpiry(new Date(data.data.user.subscriptionExpiresAt).toISOString().split('T')[0]);
      } else {
        setEditExpiry('');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleUpdatePlan = async () => {
    if (!selectedUserId) return;
    setSavingPlan(true);
    try {
      await adminService.updateUserPlan(selectedUserId, {
        plan: editPlan,
        subscriptionExpiresAt: editExpiry ? new Date(editExpiry).toISOString() : null,
      });
      // Refresh user details
      await loadUserDetails(selectedUserId);
      // Refresh list
      const usersData = await adminService.getUsers();
      setUsers(usersData.data);
    } catch (err) {
      console.error(err);
      alert('Failed to update plan.');
    } finally {
      setSavingPlan(false);
    }
  };

if (loading) {
    return (
      <DashboardLayout user={currentUser}>
        <div className="space-y-6">
          <div className="flex items-center space-x-3 text-slate-400 text-sm">
            <RefreshCw className="h-4 w-4 animate-spin text-[#7C5CFF]" />
            <span>Loading admin panel...</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-56 bg-[#111827] border border-[#1A2235] rounded-2xl" />
            <div className="h-56 bg-[#111827] border border-[#1A2235] rounded-2xl" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!currentUser || currentUser.role !== 'admin') {
    return null; // Prevents render while redirecting
  }

  return (
    <DashboardLayout user={currentUser}>
      <div className="max-w-7xl mx-auto py-8">
        {!selectedUserId ? (
          <div className="space-y-8">
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">Admin Panel</h1>

            {/* Control Tools */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

              {/* Dynamic Plans Control */}
              <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center">
                    <Settings className="h-5 w-5 text-[#7C5CFF] mr-2" />
                    <h2 className="text-xl font-bold text-white">Plans Configuration</h2>
                  </div>
                </div>
                <div className="space-y-4">
                  {plans.map(plan => (
                    <div key={plan._id} className="bg-[#0B0F1A] border border-[#1A2235] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white capitalize">{plan.name}</h3>
                        <label className="flex items-center cursor-pointer">
                          <span className="mr-2 text-xs text-slate-400">Active</span>
                          <div className="relative inline-flex items-center">
                            <input type="checkbox" className="sr-only peer" checked={plan.is_active} onChange={(e) => handlePlanChange(plan._id, { is_active: e.target.checked })} />
                            <div className="w-9 h-5 bg-[#1A2235] rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#7C5CFF]"></div>
                          </div>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                           <label className="text-xs text-slate-400 block mb-1">Price</label>
                           <input type="number" value={plan.price} onChange={(e) => handlePlanChange(plan._id, { price: Number(e.target.value) })} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                        </div>
                        <div>
                           <label className="text-xs text-slate-400 block mb-1">Priority Weight</label>
                           <input type="number" value={plan.priority_weight} onChange={(e) => handlePlanChange(plan._id, { priority_weight: Number(e.target.value) })} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                           <label className="text-xs text-slate-400 block mb-1">Max Channels</label>
                           <input type="number" value={plan.limits?.max_channels} onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, max_channels: Number(e.target.value) }})} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                        </div>
                        <div>
                           <label className="text-xs text-slate-400 block mb-1">Daily Uploads</label>
                           <input type="number" value={plan.limits?.daily_upload_limit} onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, daily_upload_limit: Number(e.target.value) }})} className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]" />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center cursor-pointer">
                          <input type="checkbox" checked={plan.features?.voice_selection} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, voice_selection: e.target.checked }})} className="mr-2" />
                          <span className="text-xs text-slate-300">Voice Selection</span>
                        </label>
                        <label className="flex items-center cursor-pointer">
                          <input type="checkbox" checked={plan.features?.scheduling} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, scheduling: e.target.checked }})} className="mr-2" />
                          <span className="text-xs text-slate-300">Scheduling</span>
                        </label>
                        <label className="flex items-center cursor-pointer">
                          <input type="checkbox" checked={plan.features?.multi_channel} onChange={(e) => handlePlanChange(plan._id, { features: { ...plan.features, multi_channel: e.target.checked }})} className="mr-2" />
                          <span className="text-xs text-slate-300">Multi Channel</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Banner Control */}
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
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label htmlFor="banner-start" className="block text-xs text-slate-400 mb-1">Start At (Optional)</label>
                      <input id="banner-start" type="datetime-local" value={bannerStart} onChange={(e) => setBannerStart(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#00D4FF] focus:outline-none [color-scheme:dark]" />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="banner-end" className="block text-xs text-slate-400 mb-1">End At (Optional)</label>
                      <input id="banner-end" type="datetime-local" value={bannerEnd} onChange={(e) => setBannerEnd(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#00D4FF] focus:outline-none [color-scheme:dark]" />
                    </div>
                  </div>
                  <label className="flex items-center justify-between cursor-pointer bg-[#0B0F1A] border border-[#1A2235] rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Banner Active</p>
                      <p className="text-xs text-slate-400">Turn on/off the global banner</p>
                    </div>
                    <span className="relative inline-flex items-center">
                    <input
                      id="banner-active"
                      type="checkbox"
                      className="sr-only peer"
                      checked={bannerActive}
                      disabled={togglingBanner || bannering}
                      onChange={(e) => handleBannerActiveToggle(e.target.checked)}
                    />
                      <span className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00D4FF]"></span>
                    </span>
                  </label>
                  <button type="submit" disabled={bannering || togglingBanner} className="w-full py-2 bg-[#00D4FF] hover:bg-[#00b5d8] text-black font-bold rounded-lg transition-colors flex justify-center items-center mt-auto">
                    {bannering ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Update Banner'}
                  </button>
                </form>
              </div>

              {/* System Config (Beta Mode) */}
              <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl lg:col-span-2">
                <div className="flex items-center mb-6">
                  <Settings className="h-5 w-5 text-slate-300 mr-2" />
                  <h2 className="text-xl font-bold text-white">System Config</h2>
                </div>
                <div className="p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-white font-bold">Beta Mode</p>
                    <p className="text-sm text-slate-400">When enabled, all free users temporarily receive &quot;Basic&quot; plan limits. Does not modify their database record.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={betaMode} onChange={(e) => handleUpdateConfig(e.target.checked)} disabled={updatingConfig} />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#7C5CFF]"></div>
                  </label>
                </div>

                <div className="mt-6 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-white font-bold">Plan Limits (Daily Uploads)</p>
                      <p className="text-sm text-slate-400">Control upload limits for each plan globally.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {(['free', 'basic', 'pro', 'premium'] as const).map((plan) => (
                      <div key={plan}>
                        <label className="block text-xs text-slate-400 mb-1 capitalize">{plan}</label>
                        <input
                          type="number"
                          min={1}
                          value={(planLimits as any)[plan]}
                          onChange={(e) => setPlanLimits(prev => ({ ...prev, [plan]: Number(e.target.value) }))}
                          className="w-full bg-[#111827] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleSavePlanLimits}
                    disabled={savingPlanLimits}
                    className="mt-4 w-full py-2 bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white font-bold rounded-lg transition-colors flex justify-center items-center"
                  >
                    {savingPlanLimits ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Plan Limits'}
                  </button>
                </div>
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

            {/* Users Table */}
            <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden">
              <div className="p-6 border-b border-[#1A2235] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-xl font-bold text-white">Users Directory</h2>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={userSearch}
                    onChange={handleUserSearchChange}
                    className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-xl pl-9 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#7C5CFF] transition-colors"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0B0F1A] text-slate-400 text-xs uppercase tracking-wider">
                      <th className="p-4 font-medium">Email</th>
                      <th className="p-4 font-medium">Plan</th>
                      <th className="p-4 font-medium hidden sm:table-cell">Usage (Today)</th>
                      <th className="p-4 font-medium hidden sm:table-cell">On Hold</th>
                      <th className="p-4 font-medium hidden md:table-cell">Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-[#1A2235]">
                    {users.map(u => (
                      <tr key={u._id} onClick={() => loadUserDetails(u._id)} className="hover:bg-[#1A2235]/50 cursor-pointer transition-colors group">
                        <td className="p-4 font-medium text-slate-200 group-hover:text-white transition-colors">{u.email}</td>
                        <td className="p-4">
                          <span className={cn("px-2.5 py-1 text-xs font-bold rounded-lg border", u.plan === 'free' ? "bg-slate-500/10 text-slate-300 border-slate-500/20" : "bg-[#7C5CFF]/10 text-[#7C5CFF] border-[#7C5CFF]/20")}>{u.plan.toUpperCase()}</span>
                        </td>
                        <td className="p-4 text-slate-400 hidden sm:table-cell">{u.uploadsUsedToday}</td>
                        <td className="p-4 text-slate-400 hidden sm:table-cell">{u.uploadsOnHold}</td>
                        <td className="p-4 text-slate-400 hidden md:table-cell">{u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt).toLocaleDateString() : 'N/A'}</td>
                      </tr>
                    ))}
                    {dashboardLoading && (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-500">Loading users...</td></tr>
                    )}
                    {!dashboardLoading && users.length === 0 && (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-500">No users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!dashboardLoading && userTotalPages > 1 && (
                <div className="p-4 border-t border-[#1A2235] flex items-center justify-between bg-[#0B0F1A]">
                  <button
                    onClick={() => setUserPage(p => Math.max(1, p - 1))}
                    disabled={userPage === 1}
                    className="px-4 py-2 bg-[#1A2235] text-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-[#2a3550] transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-slate-400">
                    Page {userPage} of {userTotalPages}
                  </span>
                  <button
                    onClick={() => setUserPage(p => Math.min(userTotalPages, p + 1))}
                    disabled={userPage === userTotalPages}
                    className="px-4 py-2 bg-[#1A2235] text-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-[#2a3550] transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <button onClick={() => setSelectedUserId(null)} className="flex items-center text-slate-400 hover:text-white transition-colors text-sm font-medium">
              <ChevronLeft className="h-4 w-4 mr-1" /> Back to Directory
            </button>

            {!userDetails ? (
              <div className="p-12 flex justify-center"><RefreshCw className="h-6 w-6 animate-spin text-slate-500" /></div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Control Panel */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
                    <h3 className="text-lg font-bold text-white mb-6">User Management</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Email</label>
                        <div className="text-white bg-[#0B0F1A] px-3 py-2 rounded-lg border border-[#1A2235]">{userDetails.user.email}</div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Plan</label>
                        <select value={editPlan} onChange={(e) => setEditPlan(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none">
                          <option value="free">Free</option>
                          <option value="basic">Basic</option>
                          <option value="pro">Pro</option>
                          <option value="premium">Premium</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Expiry Date</label>
                        <input type="date" value={editExpiry} onChange={(e) => setEditExpiry(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none [color-scheme:dark]" />
                      </div>
                      <button onClick={handleUpdatePlan} disabled={savingPlan} className="w-full flex justify-center items-center py-2.5 bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white font-bold rounded-lg transition-colors">
                        {savingPlan ? <RefreshCw className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-2" /> Save Changes</>}
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
                     <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Current Usage</h3>
                     <div className="space-y-2 text-sm text-slate-300">
                        <div className="flex justify-between"><span>Used Today:</span> <span className="text-white font-medium">{userDetails.user.uploadsUsedToday}</span></div>
                        <div className="flex justify-between"><span>On Hold:</span> <span className="text-white font-medium">{userDetails.user.uploadsOnHold}</span></div>
                        <div className="flex justify-between"><span>Verified:</span> <span className={userDetails.user.isEmailVerified ? 'text-green-400' : 'text-red-400'}>{userDetails.user.isEmailVerified ? 'Yes' : 'No'}</span></div>
                        <div className="flex justify-between"><span>YouTube:</span> <span className={userDetails.user.isYoutubeConnected ? 'text-[#00D4FF]' : 'text-slate-500'}>{userDetails.user.isYoutubeConnected ? 'Connected' : 'Disconnected'}</span></div>
                     </div>
                  </div>

                  <div className="pt-4">
                    <button onClick={handleDeleteUser} className="w-full flex justify-center items-center py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 font-bold rounded-lg transition-colors">
                      <Trash2 className="h-4 w-4 mr-2" /> Delete Account
                    </button>
                  </div>
                </div>

                {/* History & Logs */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Jobs */}
                  <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[400px]">
                     <div className="p-4 border-b border-[#1A2235] bg-[#0B0F1A] flex items-center">
                       <HistoryIcon className="h-5 w-5 mr-2 text-[#7C5CFF]" />
                       <h3 className="text-md font-bold text-white">Upload History (Jobs)</h3>
                     </div>
                     <div className="overflow-y-auto flex-1 p-4 space-y-3">
                       {userDetails.jobs.length === 0 ? <p className="text-slate-500 text-sm">No jobs found.</p> : userDetails.jobs.map(job => (
                         <div key={job._id} className="p-3 bg-[#0B0F1A] border border-[#1A2235] rounded-xl flex justify-between items-start">
                           <div>
                             <p className="text-xs text-slate-400 mb-1">{new Date(job.createdAt).toLocaleString()}</p>
                             <span className={cn("text-[10px] uppercase px-2 py-0.5 rounded font-bold tracking-wider", job.status === 'success' ? 'bg-green-500/10 text-green-400' : job.status === 'failed' ? 'bg-red-500/10 text-red-400' : job.status === 'running' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-slate-500/10 text-slate-400')}>{job.status}</span>
                           </div>
                           <div className="text-xs text-slate-500 max-w-[200px] truncate" title={job._id}>ID: {job._id}</div>
                         </div>
                       ))}
                     </div>
                  </div>

                  {/* Prompts */}
                  <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[400px]">
                     <div className="p-4 border-b border-[#1A2235] bg-[#0B0F1A] flex items-center">
                       <FileText className="h-5 w-5 mr-2 text-[#00D4FF]" />
                       <h3 className="text-md font-bold text-white">Prompts History</h3>
                     </div>
                     <div className="overflow-y-auto flex-1 p-4 space-y-3">
                       {userDetails.prompts.length === 0 ? <p className="text-slate-500 text-sm">No prompts found.</p> : userDetails.prompts.map(prompt => (
                         <div key={prompt._id} className="p-3 bg-[#0B0F1A] border border-[#1A2235] rounded-xl">
                           <p className="text-sm text-slate-200 line-clamp-2">{prompt.title || 'Untitled Prompt'}</p>
                           <p className="text-xs text-slate-500 mt-1">{new Date(prompt.createdAt).toLocaleString()}</p>
                         </div>
                       ))}
                     </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}
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
    </DashboardLayout>
  );
}
