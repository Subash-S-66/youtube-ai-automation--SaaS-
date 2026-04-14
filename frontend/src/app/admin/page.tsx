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

interface PlanLimits {
  max_channels?: number;
  daily_upload_limit?: number;
  max_media_items?: number;
  max_video_items?: number;
  max_image_items?: number;
  max_thumbnail_items?: number;
  max_clip_length_seconds?: number;
  max_total_video_duration_seconds?: number;
}

interface PlanFeatures {
  voice_selection?: boolean;
  scheduling?: boolean;
  multi_channel?: boolean;
  story_mode?: boolean;
  cta?: boolean;
  format_selection?: boolean;
  template_customization?: boolean;
  custom_media?: boolean;
}

interface PlanDraft {
  _id: string;
  name: string;
  is_active: boolean;
  price: number;
  discountPercentage?: number;
  priority_weight: number;
  featuresList?: string[];
  limits?: PlanLimits;
  features?: PlanFeatures;
}

type AdminSection = 'overview' | 'communication' | 'system' | 'plans';
type SystemPanel = 'core' | 'runtime' | 'policies' | 'recovery';
type PipelineRunnerType = 'local' | 'azure' | 'remote';
type WorkerProfileType = 'local' | 'vm' | 'cloud';
type QueuePreviewState = 'active' | 'waiting' | 'prioritized' | 'delayed';

interface RunnerRuntimeStatus {
  connected: boolean;
  configured: boolean;
  ready: boolean;
  activeWorkers: number;
  embeddedWorkers?: number;
  missingEnv: string[];
}

interface PipelineRuntimeStatus {
  redis: {
    enabled: boolean;
    status: string;
  };
  queue?: {
    enabled: boolean;
    available: boolean;
    counts: {
      waiting: number;
      active: number;
      prioritized: number;
      delayed: number;
      completed: number;
      failed: number;
      paused: number;
    };
    preview: Array<{
      queueId: string;
      mongoJobId: string | null;
      state: QueuePreviewState;
      attemptsMade: number;
      priority: number;
      enqueuedAt: string | null;
      startedAt: string | null;
      ageSeconds: number | null;
    }>;
    sampleLimitPerState: number;
    error?: string;
  };
  workerHeartbeats: {
    total: number;
    byRunner: Record<PipelineRunnerType, number>;
    bySource?: {
      dedicated: number;
      embedded: number;
    };
    byRunnerSource?: {
      dedicated: Record<PipelineRunnerType, number>;
      embedded: Record<PipelineRunnerType, number>;
    };
  };
  dedicatedWorkerHeartbeats?: number;
  embeddedWorkerHeartbeats?: number;
  includeEmbeddedWorkersInConnectivity?: boolean;
  runners: Record<PipelineRunnerType, RunnerRuntimeStatus>;
  runnerSelection: {
    effectivePrimary: PipelineRunnerType;
    systemConfigPrimary: PipelineRunnerType | null;
    envPrimary: PipelineRunnerType | null;
    envPinned: boolean;
    mode: 'pinned' | 'dynamic';
    fallbackOrder: PipelineRunnerType[];
  };
  retryPolicy?: {
    cycleAcrossRunners: boolean;
    retryCycles: number;
    runnerSequence: PipelineRunnerType[];
    minimumAttemptsPerJob: number;
  };
  embeddedWorkerConfigured: boolean;
  autoStartEmbeddedWorkerWhenMissing: boolean;
  workerRuntime?: {
    profile: WorkerProfileType;
    concurrency: number | null;
  };
}

export default function AdminDashboard() {
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [, setUsers] = useState<UserSummary[]>([]);
  const [userPage] = useState(1);
  const [, setUserTotalPages] = useState(1);
  const [userSearch] = useState('');

  // Tools forms
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifyType, setNotifyType] = useState('info');
  const [notifyTargetPlans, setNotifyTargetPlans] = useState<string[]>(['free', 'basic', 'pro', 'premium']);
  const [notifySendEmail, setNotifySendEmail] = useState(false);
  const [notifying, setNotifying] = useState(false);

  // Plans Config State
  const [plans, setPlans] = useState<PlanDraft[]>([]);
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
  const [pipelineRunner, setPipelineRunner] = useState<'local' | 'azure' | 'remote'>('local');
  const [pipelineServiceUrl, setPipelineServiceUrl] = useState('');
  const [pipelineServiceSecret, setPipelineServiceSecret] = useState('');
  const [pipelineRunnerPinned, setPipelineRunnerPinned] = useState(false);
  const [runEmbeddedWorker, setRunEmbeddedWorker] = useState(false);
  const [autoStartEmbeddedWorkerWhenMissing, setAutoStartEmbeddedWorkerWhenMissing] = useState(false);
  const [includeEmbeddedWorkersInRuntimeStatus, setIncludeEmbeddedWorkersInRuntimeStatus] = useState(false);
  const [pipelineWorkerProfile, setPipelineWorkerProfile] = useState<WorkerProfileType>('local');
  const [pipelineWorkerConcurrency, setPipelineWorkerConcurrency] = useState<number | ''>('');
  const [pipelineConcurrencyByPlan, setPipelineConcurrencyByPlan] = useState({ free: 2, basic: 5, pro: 10, premium: 20 });
  const [pipelineRetriesByPlan, setPipelineRetriesByPlan] = useState({ free: 2, basic: 3, pro: 3, premium: 5 });
  const [pipelineRetryCycles, setPipelineRetryCycles] = useState(2);
  const [pipelineCycleAcrossRunners, setPipelineCycleAcrossRunners] = useState(true);
  const [pipelineRunnerFallbackOrder, setPipelineRunnerFallbackOrder] = useState<Array<'local' | 'azure' | 'remote'>>(['azure', 'remote', 'local']);
  const [jobHistoryLimitByPlan, setJobHistoryLimitByPlan] = useState({ free: 10, basic: 50, pro: 100, premium: 200 });
  const [jobHistoryMinAgeDays, setJobHistoryMinAgeDays] = useState(7);
  const [queueWaitTimeoutMinutes, setQueueWaitTimeoutMinutes] = useState(100);
  const [processingHardTimeoutMinutes, setProcessingHardTimeoutMinutes] = useState(100);
  const [updatingConfig, setUpdatingConfig] = useState(false);
  const [planValueMap, setPlanValueMap] = useState({ free: 0, basic: 1, pro: 2, premium: 4 });
  const [savingProration, setSavingProration] = useState(false);
  const [savingPipelineRunner, setSavingPipelineRunner] = useState(false);
  const [savingRemoteRunnerConfig, setSavingRemoteRunnerConfig] = useState(false);
  const [savingWorkerRuntimePolicy, setSavingWorkerRuntimePolicy] = useState(false);
  const [savingConcurrencyPolicy, setSavingConcurrencyPolicy] = useState(false);
  const [savingRetryPolicy, setSavingRetryPolicy] = useState(false);
  const [retryingPendingJobs, setRetryingPendingJobs] = useState(false);
  const [pendingRetryScanLimit, setPendingRetryScanLimit] = useState(100);
  const [savingHistoryRetentionPolicy, setSavingHistoryRetentionPolicy] = useState(false);
  const [savingCleanupPolicy, setSavingCleanupPolicy] = useState(false);
  const [planDrafts, setPlanDrafts] = useState<PlanDraft[]>([]);
  const [savingPlans, setSavingPlans] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [activeSystemPanel, setActiveSystemPanel] = useState<SystemPanel>('runtime');
  const [runtimeStatus, setRuntimeStatus] = useState<PipelineRuntimeStatus | null>(null);
  const [runtimeStatusLoading, setRuntimeStatusLoading] = useState(false);
  const [runtimeStatusError, setRuntimeStatusError] = useState('');

  const sectionTabs: Array<{
    id: AdminSection;
    label: string;
    description: string;
    icon: typeof CheckCircle;
  }> = [
    {
      id: 'overview',
      label: 'Overview',
      description: 'Stats and quick links',
      icon: CheckCircle,
    },
    {
      id: 'communication',
      label: 'Broadcast',
      description: 'Notifications and banner',
      icon: Bell,
    },
    {
      id: 'system',
      label: 'System',
      description: 'Config and runtime policy',
      icon: Settings,
    },
    {
      id: 'plans',
      label: 'Plans',
      description: 'Plan features, limits, users, and help tickets',
      icon: CreditCard,
    },
  ];

  const systemPanelTabs: Array<{
    id: SystemPanel;
    label: string;
    description: string;
  }> = [
    {
      id: 'core',
      label: 'Core Settings',
      description: 'Beta mode and proration',
    },
    {
      id: 'runtime',
      label: 'Runtime',
      description: 'Runner, queue and workers',
    },
    {
      id: 'policies',
      label: 'Limits',
      description: 'Caps and cleanup rules',
    },
    {
      id: 'recovery',
      label: 'Recovery',
      description: 'Retry and failover controls',
    },
  ];

  const sectionCardClass = 'w-full rounded-xl border px-3 py-3 text-left transition-colors';
  const sectionCardActiveClass = 'border-[#7C5CFF]/60 bg-[#7C5CFF]/15';
  const sectionCardIdleClass = 'border-[#1A2235] bg-[#0B0F1A] hover:border-[#32507B]';

  const openPicker = (ref: RefObject<HTMLInputElement | null>) => {
    if (!ref.current) return;
    const input = ref.current as HTMLInputElement & { showPicker?: () => void };
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }
    input.focus();
  };

  const getSystemConfigPayload = () => ({
    betaMode,
    planValueMap,
    pipelineRunner,
    pipelineServiceUrl,
    pipelineServiceSecret,
    pipelineRunnerPinned,
    runEmbeddedWorker,
    autoStartEmbeddedWorkerWhenMissing,
    includeEmbeddedWorkersInRuntimeStatus,
    pipelineWorkerProfile,
    pipelineWorkerConcurrency: pipelineWorkerConcurrency === '' ? null : Number(pipelineWorkerConcurrency),
    pipelineConcurrencyByPlan,
    pipelineRetriesByPlan,
    pipelineRetryCycles,
    pipelineCycleAcrossRunners,
    pipelineRunnerFallbackOrder,
    jobHistoryLimitByPlan,
    jobHistoryMinAgeDays,
    queueWaitTimeoutMinutes,
    processingHardTimeoutMinutes,
  });

  const runnerLabelMap: Record<PipelineRunnerType, string> = {
    local: 'Local Worker',
    azure: 'Azure Container Apps',
    remote: 'Remote Pipeline Service',
  };

  const queueStateBadgeClassMap: Record<QueuePreviewState, string> = {
    active: 'bg-green-500/15 text-green-300 border-green-400/30',
    waiting: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
    prioritized: 'bg-purple-500/15 text-purple-300 border-purple-400/30',
    delayed: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  };

  const formatQueueAge = (ageSeconds: number | null | undefined): string => {
    if (!Number.isFinite(Number(ageSeconds)) || Number(ageSeconds) < 0) {
      return '--';
    }

    const value = Number(ageSeconds);
    if (value < 60) {
      return `${Math.floor(value)}s`;
    }
    if (value < 3600) {
      return `${Math.floor(value / 60)}m`;
    }
    if (value < 86400) {
      return `${Math.floor(value / 3600)}h`;
    }
    return `${Math.floor(value / 86400)}d`;
  };

  const fetchPipelineRuntimeStatus = async (silent = true) => {
    if (!silent) {
      setRuntimeStatusLoading(true);
    }

    try {
      const runtimeRes = await adminService.getPipelineRuntimeStatus();
      if (runtimeRes?.success && runtimeRes?.data) {
        setRuntimeStatus(runtimeRes.data as PipelineRuntimeStatus);
        setRuntimeStatusError('');
      } else {
        setRuntimeStatusError('Failed to load pipeline runtime status.');
      }
    } catch (err: any) {
      setRuntimeStatusError(err?.response?.data?.message || 'Failed to load pipeline runtime status.');
    } finally {
      if (!silent) {
        setRuntimeStatusLoading(false);
      }
    }
  };

  const handleFallbackOrderChange = (index: number, value: 'local' | 'azure' | 'remote') => {
    setPipelineRunnerFallbackOrder((prev) => {
      const next = [...prev] as Array<'local' | 'azure' | 'remote'>;
      const duplicateIndex = next.findIndex((runner, runnerIndex) => runner === value && runnerIndex !== index);
      if (duplicateIndex !== -1) {
        const oldValue = next[index] || 'local';
        next[duplicateIndex] = oldValue;
      }
      next[index] = value;
      return next;
    });
  };

  const handleRetryCountChange = (plan: 'free' | 'basic' | 'pro' | 'premium', value: string) => {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) ? Math.max(0, Math.min(10, Math.floor(parsed))) : 0;
    setPipelineRetriesByPlan((prev) => ({ ...prev, [plan]: safeValue }));
  };

  const handleRetryCyclesChange = (value: string) => {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.floor(parsed))) : 1;
    setPipelineRetryCycles(safeValue);
  };

  const handleConcurrencyLimitChange = (plan: 'free' | 'basic' | 'pro' | 'premium', value: string) => {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.floor(parsed))) : 1;
    setPipelineConcurrencyByPlan((prev) => ({ ...prev, [plan]: safeValue }));
  };

  const handleHistoryLimitChange = (plan: 'free' | 'basic' | 'pro' | 'premium', value: string) => {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) ? Math.max(1, Math.min(5000, Math.floor(parsed))) : 1;
    setJobHistoryLimitByPlan((prev) => ({ ...prev, [plan]: safeValue }));
  };

  const handleHistoryMinAgeDaysChange = (value: string) => {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) ? Math.max(1, Math.min(3650, Math.floor(parsed))) : 7;
    setJobHistoryMinAgeDays(safeValue);
  };

  const handleQueueWaitTimeoutMinutesChange = (value: string) => {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) ? Math.max(5, Math.min(1440, Math.floor(parsed))) : 100;
    setQueueWaitTimeoutMinutes(safeValue);
  };

  const handleProcessingHardTimeoutMinutesChange = (value: string) => {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) ? Math.max(10, Math.min(1440, Math.floor(parsed))) : 100;
    setProcessingHardTimeoutMinutes(safeValue);
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
      await adminService.updateSystemConfig({
        ...getSystemConfigPayload(),
        betaMode: newBetaMode,
      });
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
      await adminService.updateSystemConfig(getSystemConfigPayload());
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
      await adminService.updateSystemConfig(getSystemConfigPayload());
      await fetchPipelineRuntimeStatus(false);
      const runnerLabel = pipelineRunner === 'local'
        ? 'Local Worker'
        : (pipelineRunner === 'azure' ? 'Azure Container Apps' : 'Remote Pipeline Service');
      setModalConfig({
        isOpen: true,
        title: 'Pipeline Runner Updated',
        description: `Pipeline runner switched to ${runnerLabel}.`,
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

  const handleSaveRemoteRunnerConfig = async () => {
    setSavingRemoteRunnerConfig(true);
    try {
      await adminService.updateSystemConfig(getSystemConfigPayload());
      await fetchPipelineRuntimeStatus(false);
      setModalConfig({
        isOpen: true,
        title: 'Remote Worker Updated',
        description: 'Remote worker VM endpoint and secret saved successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update remote worker settings.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingRemoteRunnerConfig(false);
    }
  };

  const handleSaveWorkerRuntimePolicy = async () => {
    setSavingWorkerRuntimePolicy(true);
    try {
      await adminService.updateSystemConfig(getSystemConfigPayload());
      await fetchPipelineRuntimeStatus(false);
      setModalConfig({
        isOpen: true,
        title: 'Worker Runtime Updated',
        description: 'Worker runtime controls were saved. Dedicated workers may require restart to apply profile/concurrency changes.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update worker runtime controls.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingWorkerRuntimePolicy(false);
    }
  };

  const handleSaveConcurrencyPolicy = async () => {
    setSavingConcurrencyPolicy(true);
    try {
      await adminService.updateSystemConfig(getSystemConfigPayload());
      setModalConfig({
        isOpen: true,
        title: 'Queue Limits Updated',
        description: 'Per-plan queue/worker limits saved successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update queue limits.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingConcurrencyPolicy(false);
    }
  };

  const handleSaveRetryPolicy = async () => {
    setSavingRetryPolicy(true);
    try {
      await adminService.updateSystemConfig(getSystemConfigPayload());
      setModalConfig({
        isOpen: true,
        title: 'Retry Policy Updated',
        description: 'Pipeline retry counts and failover order saved successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update retry policy.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingRetryPolicy(false);
    }
  };

  const handleRetryPendingJobsNow = async () => {
    setRetryingPendingJobs(true);
    try {
      const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(pendingRetryScanLimit) || 100)));
      const response = await adminService.retryPendingPipelineJobs(safeLimit);
      await fetchPipelineRuntimeStatus(false);
      const details = response?.data || {};
      setModalConfig({
        isOpen: true,
        title: 'Pending Job Retry Started',
        description: `Scanned: ${details.scanned ?? 0}, Requeued: ${details.requeued ?? 0}, Already queued: ${details.alreadyQueued ?? 0}, Failed: ${details.failed ?? 0}.`,
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to requeue pending jobs.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setRetryingPendingJobs(false);
    }
  };

  const handleSaveHistoryRetentionPolicy = async () => {
    setSavingHistoryRetentionPolicy(true);
    try {
      await adminService.updateSystemConfig(getSystemConfigPayload());
      setModalConfig({
        isOpen: true,
        title: 'History Retention Updated',
        description: 'History limits and minimum age policy saved successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update history retention policy.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingHistoryRetentionPolicy(false);
    }
  };

  const handleSaveCleanupPolicy = async () => {
    setSavingCleanupPolicy(true);
    try {
      await adminService.updateSystemConfig(getSystemConfigPayload());
      setModalConfig({
        isOpen: true,
        title: 'Stuck Job Policy Updated',
        description: 'Queue wait and processing hard-timeout limits were saved successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update stuck job cleanup policy.',
        type: 'error',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingCleanupPolicy(false);
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
      max_media_items: Number(plan.limits?.max_media_items),
      max_video_items: Number(plan.limits?.max_video_items),
      max_image_items: Number(plan.limits?.max_image_items),
      max_thumbnail_items: Number(plan.limits?.max_thumbnail_items),
      max_clip_length_seconds: Number(plan.limits?.max_clip_length_seconds),
      max_total_video_duration_seconds: Number(plan.limits?.max_total_video_duration_seconds),
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
              setPipelineRunner(configRes.value.data.pipelineRunner as 'local' | 'azure' | 'remote');
            }
            if (typeof configRes.value.data.pipelineServiceUrl === 'string') {
              setPipelineServiceUrl(configRes.value.data.pipelineServiceUrl);
            }
            if (typeof configRes.value.data.pipelineServiceSecret === 'string') {
              setPipelineServiceSecret(configRes.value.data.pipelineServiceSecret);
            }
            if (typeof configRes.value.data.pipelineRunnerPinned === 'boolean') {
              setPipelineRunnerPinned(configRes.value.data.pipelineRunnerPinned);
            }
            if (typeof configRes.value.data.runEmbeddedWorker === 'boolean') {
              setRunEmbeddedWorker(configRes.value.data.runEmbeddedWorker);
            }
            if (typeof configRes.value.data.autoStartEmbeddedWorkerWhenMissing === 'boolean') {
              setAutoStartEmbeddedWorkerWhenMissing(configRes.value.data.autoStartEmbeddedWorkerWhenMissing);
            }
            if (typeof configRes.value.data.includeEmbeddedWorkersInRuntimeStatus === 'boolean') {
              setIncludeEmbeddedWorkersInRuntimeStatus(configRes.value.data.includeEmbeddedWorkersInRuntimeStatus);
            }
            if (typeof configRes.value.data.pipelineWorkerProfile === 'string') {
              const workerProfile = String(configRes.value.data.pipelineWorkerProfile || '').trim().toLowerCase();
              if (workerProfile === 'local' || workerProfile === 'vm' || workerProfile === 'cloud') {
                setPipelineWorkerProfile(workerProfile as WorkerProfileType);
              }
            }
            if (typeof configRes.value.data.pipelineWorkerConcurrency === 'number' && Number.isFinite(configRes.value.data.pipelineWorkerConcurrency)) {
              setPipelineWorkerConcurrency(Math.max(1, Math.min(32, Math.floor(configRes.value.data.pipelineWorkerConcurrency))));
            } else {
              setPipelineWorkerConcurrency('');
            }
            if (configRes.value.data.pipelineConcurrencyByPlan) {
              setPipelineConcurrencyByPlan({
                free: Number(configRes.value.data.pipelineConcurrencyByPlan.free ?? 2),
                basic: Number(configRes.value.data.pipelineConcurrencyByPlan.basic ?? 5),
                pro: Number(configRes.value.data.pipelineConcurrencyByPlan.pro ?? 10),
                premium: Number(configRes.value.data.pipelineConcurrencyByPlan.premium ?? 20),
              });
            }
            if (configRes.value.data.pipelineRetriesByPlan) {
              setPipelineRetriesByPlan({
                free: Number(configRes.value.data.pipelineRetriesByPlan.free ?? 2),
                basic: Number(configRes.value.data.pipelineRetriesByPlan.basic ?? 3),
                pro: Number(configRes.value.data.pipelineRetriesByPlan.pro ?? 3),
                premium: Number(configRes.value.data.pipelineRetriesByPlan.premium ?? 5),
              });
            }
            if (typeof configRes.value.data.pipelineRetryCycles === 'number') {
              const retryCycles = Math.max(1, Math.min(10, Math.floor(Number(configRes.value.data.pipelineRetryCycles || 2))));
              setPipelineRetryCycles(retryCycles);
            }
            if (typeof configRes.value.data.pipelineCycleAcrossRunners === 'boolean') {
              setPipelineCycleAcrossRunners(configRes.value.data.pipelineCycleAcrossRunners);
            }
            if (Array.isArray(configRes.value.data.pipelineRunnerFallbackOrder) && configRes.value.data.pipelineRunnerFallbackOrder.length > 0) {
              const normalizedOrder = configRes.value.data.pipelineRunnerFallbackOrder
                .map((runner: unknown) => String(runner || '').trim().toLowerCase())
                .filter((runner: string) => runner === 'local' || runner === 'azure' || runner === 'remote') as Array<'local' | 'azure' | 'remote'>;
              if (normalizedOrder.length > 0) {
                setPipelineRunnerFallbackOrder(normalizedOrder.slice(0, 3));
              }
            }
            if (configRes.value.data.jobHistoryLimitByPlan) {
              setJobHistoryLimitByPlan({
                free: Number(configRes.value.data.jobHistoryLimitByPlan.free ?? 10),
                basic: Number(configRes.value.data.jobHistoryLimitByPlan.basic ?? 50),
                pro: Number(configRes.value.data.jobHistoryLimitByPlan.pro ?? 100),
                premium: Number(configRes.value.data.jobHistoryLimitByPlan.premium ?? 200),
              });
            }
            if (typeof configRes.value.data.jobHistoryMinAgeDays === 'number') {
              setJobHistoryMinAgeDays(Math.max(1, Math.min(3650, Math.floor(Number(configRes.value.data.jobHistoryMinAgeDays || 7)))));
            }
            if (typeof configRes.value.data.queueWaitTimeoutMinutes === 'number') {
              setQueueWaitTimeoutMinutes(Math.max(5, Math.min(1440, Math.floor(Number(configRes.value.data.queueWaitTimeoutMinutes || 100)))));
            }
            if (typeof configRes.value.data.processingHardTimeoutMinutes === 'number') {
              setProcessingHardTimeoutMinutes(Math.max(10, Math.min(1440, Math.floor(Number(configRes.value.data.processingHardTimeoutMinutes || 100)))));
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

  useEffect(() => {
    let isMounted = true;

    const loadRuntimeStatus = async (silent: boolean) => {
      if (!silent && isMounted) {
        setRuntimeStatusLoading(true);
      }
      try {
        const runtimeRes = await adminService.getPipelineRuntimeStatus();
        if (!isMounted) return;
        if (runtimeRes?.success && runtimeRes?.data) {
          setRuntimeStatus(runtimeRes.data as PipelineRuntimeStatus);
          setRuntimeStatusError('');
        } else {
          setRuntimeStatusError('Failed to load pipeline runtime status.');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setRuntimeStatusError(err?.response?.data?.message || 'Failed to load pipeline runtime status.');
      } finally {
        if (!silent && isMounted) {
          setRuntimeStatusLoading(false);
        }
      }
    };

    void loadRuntimeStatus(false);
    const timer = window.setInterval(() => {
      void loadRuntimeStatus(true);
    }, 15000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <>
      <div className="max-w-7xl mx-auto py-8">
        <div className="space-y-8">
          <div className="rounded-2xl border border-[#1A2235] bg-linear-to-br from-[#121B2D] via-[#101827] to-[#0B0F1A] p-6 shadow-xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#00D4FF]">Admin Workspace</p>
                <h1 className="mt-2 text-3xl font-extrabold text-white">Control Center</h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-300">
                  Manage users, support, billing, queue health, and runner reliability from one place with faster section-based controls.
                </p>
              </div>
              <div className="inline-flex items-center rounded-full border border-[#2C3B58] bg-[#0B0F1A]/70 px-3 py-1 text-xs font-semibold text-slate-300">
                Active Section: <span className="ml-1 text-white capitalize">{activeSection}</span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-[#20304A] bg-[#0B0F1A]/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Total Users</p>
                <p className="text-lg font-bold text-white">{stats?.totalUsers ?? '--'}</p>
              </div>
              <div className="rounded-lg border border-[#20304A] bg-[#0B0F1A]/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Active Subs</p>
                <p className="text-lg font-bold text-white">{stats?.totalActiveSubscriptions ?? '--'}</p>
              </div>
              <div className="rounded-lg border border-[#20304A] bg-[#0B0F1A]/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Jobs</p>
                <p className="text-lg font-bold text-white">{stats?.jobs?.total ?? '--'}</p>
              </div>
              <div className="rounded-lg border border-[#20304A] bg-[#0B0F1A]/70 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Success Rate</p>
                <p className="text-lg font-bold text-white">{stats?.jobs?.successRate ?? '--'}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#111827] border border-[#1A2235] rounded-2xl p-3 shadow-lg">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
              {sectionTabs.map((section) => {
                const Icon = section.icon;
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      sectionCardClass,
                      active ? sectionCardActiveClass : sectionCardIdleClass
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", active ? "text-[#7C5CFF]" : "text-[#00D4FF]")} />
                      <p className="text-sm font-semibold text-white">{section.label}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{section.description}</p>
                  </button>
                );
              })}

              <Link
                href="/admin/users"
                className={cn(sectionCardClass, sectionCardIdleClass, 'group')}
              >
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#00D4FF] group-hover:text-[#7C5CFF] transition-colors" />
                  <p className="text-sm font-semibold text-white">Users Directory</p>
                </div>
                <p className="mt-1 text-xs text-slate-400">Browse users and manage account access</p>
              </Link>

              <Link
                href="/admin/tickets"
                className={cn(sectionCardClass, sectionCardIdleClass, 'group')}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[#00D4FF] group-hover:text-[#7C5CFF] transition-colors" />
                  <p className="text-sm font-semibold text-white">Help Tickets</p>
                </div>
                <p className="mt-1 text-xs text-slate-400">Track and resolve support issues quickly</p>
              </Link>
            </div>
          </div>

          {/* Control Tools */}
          {activeSection !== 'overview' && (
            <>
              <div
                className={cn(
                  'grid gap-6',
                  activeSection === 'communication' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
                )}
              >
              {/* Notification Sender */}
              <div className={cn('bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl', activeSection !== 'communication' && 'hidden')}>
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
              <div className={cn('bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl', activeSection !== 'communication' && 'hidden')}>
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
                  <button type="submit" disabled={bannering || togglingBanner} className="w-full py-2 bg-[#00D4FF] hover:bg-[#00b5d8] text-white font-bold rounded-lg transition-colors flex justify-center items-center mt-auto">
                    {bannering ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Update Banner'}
                  </button>
                </form>
              </div>

              {/* System Config (Beta Mode) */}
              <div className={cn('bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl', activeSection !== 'system' && 'hidden')}>
                <div className="flex items-center mb-6">
                  <Settings className="h-5 w-5 text-slate-300 mr-2" />
                  <h2 className="text-xl font-bold text-white">System Config</h2>
                </div>
                <div className="mb-4 rounded-xl border border-[#1A2235] bg-[#0B0F1A] p-3">
                  <p className="text-xs text-slate-400 mb-2">Split view for high-content settings</p>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {systemPanelTabs.map((panel) => {
                      const active = activeSystemPanel === panel.id;
                      return (
                        <button
                          key={`system-panel-${panel.id}`}
                          type="button"
                          onClick={() => setActiveSystemPanel(panel.id)}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-left transition-colors',
                            active
                              ? 'border-[#7C5CFF]/70 bg-[#7C5CFF]/15'
                              : 'border-[#1A2235] bg-[#111827] hover:border-[#32507B]'
                          )}
                        >
                          <p className="text-xs font-semibold text-white">{panel.label}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">{panel.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={cn('p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl flex items-center justify-between', activeSystemPanel !== 'core' && 'hidden')}>
                  <div>
                    <p className="text-white font-bold">Beta Mode</p>
                    <p className="text-sm text-slate-400">When enabled, all free users temporarily receive "Basic" plan limits. Does not modify their database record.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input id="beta-mode-toggle" aria-label="Toggle Beta Mode" type="checkbox" className="sr-only peer" checked={betaMode} onChange={(e) => handleUpdateConfig(e.target.checked)} disabled={updatingConfig} />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#7C5CFF]"></div>
                  </label>
                </div>
                <div className={cn('mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl', activeSystemPanel !== 'core' && 'hidden')}>
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
                <div className={cn('mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl', activeSystemPanel !== 'runtime' && 'hidden')}>
                  <p className="text-sm font-semibold text-white mb-2">Pipeline Runner</p>
                  <p className="text-xs text-slate-400 mb-3">Choose primary execution environment for pipeline runs.</p>
                  <div className="mb-3 p-3 rounded-lg border border-[#1A2235] bg-[#111827]">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-slate-200">Worker Connectivity</p>
                      <button
                        type="button"
                        onClick={() => { void fetchPipelineRuntimeStatus(false); }}
                        className="text-[11px] px-2 py-1 rounded bg-[#1A2235] text-slate-200 hover:text-white transition-colors"
                      >
                        {runtimeStatusLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Refresh'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(['local', 'azure', 'remote'] as const).map((runner) => {
                        const runnerStatus = runtimeStatus?.runners?.[runner];
                        const isConnected = Boolean(runnerStatus?.connected);
                        const isConfigured = Boolean(runnerStatus?.configured);
                        const isReady = Boolean(runnerStatus?.ready);
                        const dotClass = isReady
                          ? 'bg-green-500'
                          : isConnected
                            ? 'bg-amber-400'
                            : 'bg-red-500';
                        const statusLabel = isReady
                          ? 'Connected'
                          : isConnected
                            ? 'Config Error'
                            : isConfigured
                              ? 'Worker Offline'
                              : 'Not Ready';
                        const statusTextClass = isReady
                          ? 'text-green-400'
                          : isConnected
                            ? 'text-amber-300'
                            : 'text-red-400';
                        const workerCount = runnerStatus?.activeWorkers ?? 0;
                        const embeddedWorkerCount = runnerStatus?.embeddedWorkers ?? 0;
                        const totalWorkerCount = workerCount + embeddedWorkerCount;
                        const missingEnv = runnerStatus?.missingEnv || [];

                        return (
                          <div key={`runtime-${runner}`} className="rounded-lg border border-[#1A2235] bg-[#0B0F1A] p-2.5">
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] text-slate-300 font-semibold">{runnerLabelMap[runner]}</p>
                              <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
                            </div>
                            <p className={`mt-1 text-[11px] font-semibold ${statusTextClass}`}>
                              {statusLabel}
                            </p>
                            <p className="text-[10px] text-slate-500">Workers: {totalWorkerCount}</p>
                            {embeddedWorkerCount > 0 ? (
                              <p className="text-[10px] text-amber-300">
                                Dedicated: {workerCount} | Embedded(API): {embeddedWorkerCount}
                              </p>
                            ) : null}
                            {missingEnv.length > 0 ? (
                              <p className="mt-1 text-[10px] text-amber-300">Missing: {missingEnv.join(', ')}</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {runtimeStatus ? (
                      <p className="mt-2 text-[11px] text-slate-500">
                        Redis: {runtimeStatus.redis.status} | Dedicated Workers: {runtimeStatus.dedicatedWorkerHeartbeats ?? runtimeStatus.workerHeartbeats.bySource?.dedicated ?? runtimeStatus.workerHeartbeats.total} | Embedded(API): {runtimeStatus.embeddedWorkerHeartbeats ?? runtimeStatus.workerHeartbeats.bySource?.embedded ?? 0} | Mode: {runtimeStatus.runnerSelection.mode} | Effective: {runnerLabelMap[runtimeStatus.runnerSelection.effectivePrimary]} | Worker Profile: {runtimeStatus.workerRuntime?.profile || pipelineWorkerProfile} | Concurrency: {runtimeStatus.workerRuntime?.concurrency ?? 'auto'}
                      </p>
                    ) : null}

                    {runtimeStatus?.queue ? (
                      <div className="mt-3 rounded-lg border border-[#1A2235] bg-[#111827] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-200">Redis Queue Snapshot</p>
                          <p
                            className={cn(
                              'text-[11px] font-semibold',
                              runtimeStatus.queue.available
                                ? 'text-green-400'
                                : (runtimeStatus.queue.enabled ? 'text-amber-300' : 'text-slate-500')
                            )}
                          >
                            {runtimeStatus.queue.available
                              ? 'Live'
                              : (runtimeStatus.queue.enabled ? 'Queue Unavailable' : 'Redis Disabled')}
                          </p>
                        </div>

                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                          {([
                            { key: 'waiting', label: 'Waiting' },
                            { key: 'active', label: 'Active' },
                            { key: 'prioritized', label: 'Priority' },
                            { key: 'delayed', label: 'Delayed' },
                            { key: 'failed', label: 'Failed' },
                            { key: 'completed', label: 'Done' },
                            { key: 'paused', label: 'Paused' },
                          ] as const).map((entry) => (
                            <div key={`queue-count-${entry.key}`} className="rounded-md border border-[#1A2235] bg-[#0B0F1A] px-2 py-1.5">
                              <p className="text-[10px] uppercase tracking-wide text-slate-500">{entry.label}</p>
                              <p className="text-sm font-semibold text-white">{runtimeStatus.queue?.counts?.[entry.key] ?? 0}</p>
                            </div>
                          ))}
                        </div>

                        {runtimeStatus.queue.preview.length > 0 ? (
                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full min-w-160 text-left text-[11px]">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="pb-1 font-medium">State</th>
                                  <th className="pb-1 font-medium">Queue ID</th>
                                  <th className="pb-1 font-medium">Job ID</th>
                                  <th className="pb-1 font-medium">Age</th>
                                  <th className="pb-1 font-medium">Attempts</th>
                                  <th className="pb-1 font-medium">Priority</th>
                                </tr>
                              </thead>
                              <tbody>
                                {runtimeStatus.queue.preview.map((job) => (
                                  <tr key={`${job.state}-${job.queueId}-${job.mongoJobId || 'na'}`} className="border-t border-[#1A2235] text-slate-200">
                                    <td className="py-1.5 pr-2">
                                      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', queueStateBadgeClassMap[job.state])}>
                                        {job.state}
                                      </span>
                                    </td>
                                    <td className="py-1.5 pr-2 font-mono text-[10px] text-slate-300">{job.queueId || '-'}</td>
                                    <td className="py-1.5 pr-2 font-mono text-[10px] text-slate-400">{job.mongoJobId || '-'}</td>
                                    <td className="py-1.5 pr-2">{formatQueueAge(job.ageSeconds)}</td>
                                    <td className="py-1.5 pr-2">{job.attemptsMade}</td>
                                    <td className="py-1.5 pr-2">{job.priority}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="mt-2 text-[11px] text-slate-500">No active/waiting/prioritized/delayed jobs in queue right now.</p>
                        )}

                        {runtimeStatus.queue.error ? (
                          <p className="mt-2 text-[11px] text-amber-300">Queue note: {runtimeStatus.queue.error}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {runtimeStatus?.autoStartEmbeddedWorkerWhenMissing ? (
                      <p className="mt-2 text-[11px] text-amber-300">
                        Embedded worker auto-recovery is enabled on API server. Disable this for brain-only backend mode.
                      </p>
                    ) : null}

                    {runtimeStatusError ? (
                      <p className="mt-2 text-[11px] text-red-400">{runtimeStatusError}</p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Runner</label>
                      <select
                        id="pipeline-runner-select"
                        aria-label="Pipeline Runner"
                        value={pipelineRunner}
                        onChange={(e) => setPipelineRunner(e.target.value as 'local' | 'azure' | 'remote')}
                        className="w-full bg-[#111827] text-white px-2 py-2 rounded border border-[#1A2235]"
                      >
                        <option value="local">Local Worker</option>
                        <option value="azure">Azure Container Apps</option>
                        <option value="remote">Remote Pipeline Service</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleSavePipelineRunner}
                        disabled={savingPipelineRunner}
                        className="w-full py-2 bg-[#00D4FF] hover:bg-[#00b5d8] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {savingPipelineRunner ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Pipeline Runner'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 p-3 rounded-lg border border-[#1A2235] bg-[#111827]">
                    <p className="text-xs font-semibold text-slate-200 mb-2">Remote Worker VM Endpoint</p>
                    <p className="text-[11px] text-slate-500 mb-3">Use this to register a new worker VM/service URL directly from admin panel. Example: https://worker.yourdomain.com</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Remote Service URL</label>
                        <input
                          id="pipeline-service-url"
                          aria-label="Remote pipeline service url"
                          type="text"
                          placeholder="https://worker.yourdomain.com"
                          value={pipelineServiceUrl}
                          onChange={(e) => setPipelineServiceUrl(e.target.value)}
                          className="w-full bg-[#0B0F1A] text-white px-2 py-2 rounded border border-[#1A2235]"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Shared Secret (Optional)</label>
                        <input
                          id="pipeline-service-secret"
                          aria-label="Remote pipeline service secret"
                          type="password"
                          placeholder="x-webhook-secret"
                          value={pipelineServiceSecret}
                          onChange={(e) => setPipelineServiceSecret(e.target.value)}
                          className="w-full bg-[#0B0F1A] text-white px-2 py-2 rounded border border-[#1A2235]"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveRemoteRunnerConfig}
                      disabled={savingRemoteRunnerConfig}
                      className="mt-3 w-full py-2 bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingRemoteRunnerConfig ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Remote Worker VM'}
                    </button>
                  </div>
                </div>

                <div className={cn('mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl', activeSystemPanel !== 'runtime' && 'hidden')}>
                  <p className="text-sm font-semibold text-white mb-2">Worker Runtime Controls</p>
                  <p className="text-xs text-slate-400 mb-3">Manage worker behavior from admin panel. Profile/concurrency updates apply after dedicated worker restart.</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center justify-between rounded-lg border border-[#1A2235] bg-[#111827] px-3 py-2">
                      <span className="text-xs text-slate-300">Pin runner to env value</span>
                      <input
                        type="checkbox"
                        checked={pipelineRunnerPinned}
                        onChange={(e) => setPipelineRunnerPinned(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-600 bg-[#0B0F1A]"
                      />
                    </label>

                    <label className="flex items-center justify-between rounded-lg border border-[#1A2235] bg-[#111827] px-3 py-2">
                      <span className="text-xs text-slate-300">Run embedded worker on API</span>
                      <input
                        type="checkbox"
                        checked={runEmbeddedWorker}
                        onChange={(e) => setRunEmbeddedWorker(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-600 bg-[#0B0F1A]"
                      />
                    </label>

                    <label className="flex items-center justify-between rounded-lg border border-[#1A2235] bg-[#111827] px-3 py-2">
                      <span className="text-xs text-slate-300">Auto-start embedded worker if no dedicated heartbeat</span>
                      <input
                        type="checkbox"
                        checked={autoStartEmbeddedWorkerWhenMissing}
                        onChange={(e) => setAutoStartEmbeddedWorkerWhenMissing(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-600 bg-[#0B0F1A]"
                      />
                    </label>

                    <label className="flex items-center justify-between rounded-lg border border-[#1A2235] bg-[#111827] px-3 py-2">
                      <span className="text-xs text-slate-300">Include embedded workers in connectivity cards</span>
                      <input
                        type="checkbox"
                        checked={includeEmbeddedWorkersInRuntimeStatus}
                        onChange={(e) => setIncludeEmbeddedWorkersInRuntimeStatus(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-600 bg-[#0B0F1A]"
                      />
                    </label>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Worker profile</label>
                      <select
                        value={pipelineWorkerProfile}
                        onChange={(e) => setPipelineWorkerProfile(e.target.value as WorkerProfileType)}
                        className="w-full bg-[#111827] text-white px-2 py-2 rounded border border-[#1A2235]"
                      >
                        <option value="local">Local (single worker)</option>
                        <option value="vm">VM (parallel)</option>
                        <option value="cloud">Cloud (high parallel)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Worker concurrency override</label>
                      <input
                        type="number"
                        min="1"
                        max="32"
                        placeholder="Auto"
                        value={pipelineWorkerConcurrency}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!raw.trim()) {
                            setPipelineWorkerConcurrency('');
                            return;
                          }
                          const parsed = Number(raw);
                          const safe = Number.isFinite(parsed) ? Math.max(1, Math.min(32, Math.floor(parsed))) : 1;
                          setPipelineWorkerConcurrency(safe);
                        }}
                        className="w-full bg-[#111827] text-white px-2 py-2 rounded border border-[#1A2235]"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveWorkerRuntimePolicy}
                    disabled={savingWorkerRuntimePolicy}
                    className="mt-3 w-full py-2 bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingWorkerRuntimePolicy ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Worker Runtime Controls'}
                  </button>
                </div>

                <div className={cn('mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl', activeSystemPanel !== 'policies' && 'hidden')}>
                  <p className="text-sm font-semibold text-white mb-2">Queue And Worker Limits (Per Plan)</p>
                  <p className="text-xs text-slate-400 mb-3">Controls how many pipeline jobs a user can run or queue at one time (also used for channel hold cap).</p>

                  <div className="grid grid-cols-2 gap-3">
                    {(['free', 'basic', 'pro', 'premium'] as const).map((plan) => (
                      <div key={`concurrency-${plan}`}>
                        <label className="text-xs text-slate-400 block mb-1 capitalize">{plan} Limit</label>
                        <input
                          id={`pipeline-concurrency-${plan}`}
                          aria-label={`${plan} queue limit`}
                          type="number"
                          min="1"
                          max="100"
                          value={(pipelineConcurrencyByPlan as any)[plan]}
                          onChange={(e) => handleConcurrencyLimitChange(plan, e.target.value)}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveConcurrencyPolicy}
                    disabled={savingConcurrencyPolicy}
                    className="mt-3 w-full py-2 bg-[#f59e0b] hover:bg-[#d97706] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingConcurrencyPolicy ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Queue And Worker Limits'}
                  </button>
                </div>

                <div className={cn('mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl', activeSystemPanel !== 'policies' && 'hidden')}>
                  <p className="text-sm font-semibold text-white mb-2">History Retention Policy</p>
                  <p className="text-xs text-slate-400 mb-3">
                    Records are deleted only when both conditions are true: the user has more records than the plan cap, and records are older than minimum age.
                    If total history is below the cap, nothing is deleted even when records are very old.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    {(['free', 'basic', 'pro', 'premium'] as const).map((plan) => (
                      <div key={`history-limit-${plan}`}>
                        <label className="text-xs text-slate-400 block mb-1 capitalize">{plan} History Cap</label>
                        <input
                          id={`history-limit-${plan}`}
                          aria-label={`${plan} history cap`}
                          type="number"
                          min="1"
                          max="5000"
                          value={(jobHistoryLimitByPlan as any)[plan]}
                          onChange={(e) => handleHistoryLimitChange(plan, e.target.value)}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="mt-3">
                    <label className="text-xs text-slate-400 block mb-1">Minimum Age Before Deletion (Days)</label>
                    <input
                      id="history-min-age-days"
                      aria-label="Minimum history age days"
                      type="number"
                      min="1"
                      max="3650"
                      value={jobHistoryMinAgeDays}
                      onChange={(e) => handleHistoryMinAgeDaysChange(e.target.value)}
                      className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">Example: 7 means only records older than 7 days are eligible, and only if total history exceeds the plan cap.</p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveHistoryRetentionPolicy}
                    disabled={savingHistoryRetentionPolicy}
                    className="mt-3 w-full py-2 bg-[#38bdf8] hover:bg-[#0ea5e9] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingHistoryRetentionPolicy ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save History Retention Policy'}
                  </button>
                </div>

                <div className={cn('mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl', activeSystemPanel !== 'policies' && 'hidden')}>
                  <p className="text-sm font-semibold text-white mb-2">Stuck Job Cleanup Policy</p>
                  <p className="text-xs text-slate-400 mb-3">Controls when stale queue/processing jobs are auto-terminated during recovery and periodic cleanup.</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Queue Wait Timeout (Minutes)</label>
                      <input
                        id="queue-wait-timeout-minutes"
                        aria-label="Queue wait timeout minutes"
                        type="number"
                        min="5"
                        max="1440"
                        value={queueWaitTimeoutMinutes}
                        onChange={(e) => handleQueueWaitTimeoutMinutesChange(e.target.value)}
                        className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Processing Hard Timeout (Minutes)</label>
                      <input
                        id="processing-hard-timeout-minutes"
                        aria-label="Processing hard timeout minutes"
                        type="number"
                        min="10"
                        max="1440"
                        value={processingHardTimeoutMinutes}
                        onChange={(e) => handleProcessingHardTimeoutMinutesChange(e.target.value)}
                        className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveCleanupPolicy}
                    disabled={savingCleanupPolicy}
                    className="mt-3 w-full py-2 bg-[#eab308] hover:bg-[#ca8a04] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingCleanupPolicy ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Stuck Job Cleanup Policy'}
                  </button>
                </div>

                <div className={cn('mt-4 p-4 bg-[#0B0F1A] border border-[#1A2235] rounded-xl', activeSystemPanel !== 'recovery' && 'hidden')}>
                  <p className="text-sm font-semibold text-white mb-2">Retry & Failover Policy</p>
                  <p className="text-xs text-slate-400 mb-3">Configure retry counts per plan and explicit Try #1 / Try #2 / Try #3 order. When cycling is enabled, jobs repeat this sequence instead of sticking on one runner.</p>

                  {runtimeStatus?.retryPolicy ? (
                    <p className="text-[11px] text-slate-500 mb-3">
                      Runtime cycle: {runtimeStatus.retryPolicy.cycleAcrossRunners ? 'ON' : 'OFF'} | Cycles: {runtimeStatus.retryPolicy.retryCycles} | Sequence: {runtimeStatus.retryPolicy.runnerSequence.map((runner) => runnerLabelMap[runner]).join(' -> ')} | Minimum attempts/job: {runtimeStatus.retryPolicy.minimumAttemptsPerJob}
                    </p>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {(['free', 'basic', 'pro', 'premium'] as const).map((plan) => (
                      <div key={`retry-${plan}`}>
                        <label className="text-xs text-slate-400 block mb-1 capitalize">{plan} Retries</label>
                        <input
                          id={`retry-count-${plan}`}
                          aria-label={`${plan} retry count`}
                          type="number"
                          min="0"
                          max="10"
                          value={(pipelineRetriesByPlan as any)[plan]}
                          onChange={(e) => handleRetryCountChange(plan, e.target.value)}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <label className="flex items-center justify-between rounded-lg border border-[#1A2235] bg-[#111827] px-3 py-2">
                      <span className="text-xs text-slate-300">Cycle through all runners repeatedly</span>
                      <input
                        type="checkbox"
                        checked={pipelineCycleAcrossRunners}
                        onChange={(e) => setPipelineCycleAcrossRunners(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-600 bg-[#0B0F1A]"
                      />
                    </label>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Full cycles before final failure</label>
                      <input
                        id="pipeline-retry-cycles"
                        aria-label="Pipeline retry cycles"
                        type="number"
                        min="1"
                        max="10"
                        value={pipelineRetryCycles}
                        onChange={(e) => handleRetryCyclesChange(e.target.value)}
                        className="w-full bg-[#111827] text-white px-2 py-2 rounded border border-[#1A2235]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[0, 1, 2].map((index) => (
                      <div key={`fallback-runner-${index}`}>
                        <label className="text-xs text-slate-400 block mb-1">Try #{index + 1}</label>
                        <select
                          id={`pipeline-fallback-${index}`}
                          aria-label={`Pipeline fallback runner ${index + 1}`}
                          value={pipelineRunnerFallbackOrder[index] || 'local'}
                          onChange={(e) => handleFallbackOrderChange(index, e.target.value as 'local' | 'azure' | 'remote')}
                          className="w-full bg-[#111827] text-white px-2 py-2 rounded border border-[#1A2235]"
                        >
                          <option value="local">Local Worker</option>
                          <option value="azure">Azure Container Apps</option>
                          <option value="remote">Remote Pipeline Service</option>
                        </select>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Pending job scan limit</label>
                      <input
                        id="pending-retry-scan-limit"
                        aria-label="Pending retry scan limit"
                        type="number"
                        min="1"
                        max="500"
                        value={pendingRetryScanLimit}
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          const safeValue = Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : 100;
                          setPendingRetryScanLimit(safeValue);
                        }}
                        className="w-full bg-[#111827] text-white px-2 py-2 rounded border border-[#1A2235]"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">Scans pending DB jobs and requeues missing BullMQ entries immediately.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRetryPendingJobsNow}
                      disabled={retryingPendingJobs}
                      className="sm:self-end py-2 px-4 bg-[#3b82f6] hover:bg-[#2563eb] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {retryingPendingJobs ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Retry Pending Jobs Now'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveRetryPolicy}
                    disabled={savingRetryPolicy}
                    className="mt-3 w-full py-2 bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold rounded-lg transition-colors flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingRetryPolicy ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Retry Policy'}
                  </button>
                </div>
              </div>
            </div>

            {/* Dynamic Plans Control */}
            <div className={cn('bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl', activeSection !== 'plans' && 'hidden')}>
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

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Max Media Items</label>
                        <input
                          aria-label={`Max media items for ${plan.name}`}
                          type="number"
                          value={plan.limits?.max_media_items ?? 0}
                          onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, max_media_items: Number(e.target.value) }})}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Max Video Clips</label>
                        <input
                          aria-label={`Max video items for ${plan.name}`}
                          type="number"
                          value={plan.limits?.max_video_items ?? 0}
                          onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, max_video_items: Number(e.target.value) }})}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Max Images</label>
                        <input
                          aria-label={`Max image items for ${plan.name}`}
                          type="number"
                          value={plan.limits?.max_image_items ?? 0}
                          onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, max_image_items: Number(e.target.value) }})}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Max Thumbnails</label>
                        <input
                          aria-label={`Max thumbnail items for ${plan.name}`}
                          type="number"
                          value={plan.limits?.max_thumbnail_items ?? 0}
                          onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, max_thumbnail_items: Number(e.target.value) }})}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Max Clip Length (seconds)</label>
                        <input
                          aria-label={`Max clip length seconds for ${plan.name}`}
                          type="number"
                          value={plan.limits?.max_clip_length_seconds ?? 0}
                          onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, max_clip_length_seconds: Number(e.target.value) }})}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">Max Total Video Duration (seconds)</label>
                        <input
                          aria-label={`Max total video duration seconds for ${plan.name}`}
                          type="number"
                          value={plan.limits?.max_total_video_duration_seconds ?? 0}
                          onChange={(e) => handlePlanChange(plan._id, { limits: { ...plan.limits, max_total_video_duration_seconds: Number(e.target.value) }})}
                          className="w-full bg-[#111827] text-white px-2 py-1 rounded border border-[#1A2235]"
                        />
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

            </>
          )}

          {activeSection === 'overview' && (
            <>
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

          <div className="bg-[#111827] border border-[#1A2235] rounded-2xl p-5 shadow-lg">
            <h2 className="text-lg font-semibold text-white">How To Use This Panel</h2>
            <p className="mt-1 text-sm text-slate-400">Use the section tabs above to manage each area without scrolling through every tool at once.</p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <button type="button" onClick={() => setActiveSection('communication')} className="text-left rounded-xl border border-[#1A2235] bg-[#0B0F1A] px-3 py-3 hover:border-[#7C5CFF]/50 transition-colors">
                <p className="font-semibold text-white">Broadcast Center</p>
                <p className="text-slate-400 text-xs mt-1">Send notifications and publish global banners.</p>
              </button>
              <button type="button" onClick={() => setActiveSection('system')} className="text-left rounded-xl border border-[#1A2235] bg-[#0B0F1A] px-3 py-3 hover:border-[#7C5CFF]/50 transition-colors">
                <p className="font-semibold text-white">System Policies</p>
                <p className="text-slate-400 text-xs mt-1">Tune beta mode, queue limits, runner, and retry behavior.</p>
              </button>
              <button type="button" onClick={() => setActiveSection('plans')} className="text-left rounded-xl border border-[#1A2235] bg-[#0B0F1A] px-3 py-3 hover:border-[#7C5CFF]/50 transition-colors">
                <p className="font-semibold text-white">Plan Controls</p>
                <p className="text-slate-400 text-xs mt-1">Edit plan pricing, features, and usage limits.</p>
              </button>
              <Link href="/admin/users" className="rounded-xl border border-[#1A2235] bg-[#0B0F1A] px-3 py-3 hover:border-[#7C5CFF]/50 transition-colors">
                <p className="font-semibold text-white">Users Directory</p>
                <p className="text-slate-400 text-xs mt-1">Manage individual users, history, and subscriptions.</p>
              </Link>
              <Link href="/admin/tickets" className="rounded-xl border border-[#1A2235] bg-[#0B0F1A] px-3 py-3 hover:border-[#7C5CFF]/50 transition-colors">
                <p className="font-semibold text-white">Help Tickets</p>
                <p className="text-slate-400 text-xs mt-1">Review support conversations, status, and responses.</p>
              </Link>
            </div>
          </div>
            </>
          )}

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
