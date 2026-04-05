'use client';
import dynamic from "next/dynamic";
import { useEffect, useState, Suspense, useRef, useCallback } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Play, Youtube, ListVideo, Clock, FileVideo,
  ShieldAlert, Sparkles, RefreshCw, PenLine, List,
  Mic, Volume2
} from 'lucide-react';
import { authService } from '../../services/authService';
import { youtubeService } from '../../services/youtubeService';
import { promptService } from '../../services/promptService';
import { pipelineService } from '../../services/pipelineService';
import { paymentService } from '../../services/paymentService';
import { scheduleService } from '../../services/scheduleService';
import DashboardLayout from '../../components/layout/DashboardLayout';
const AppModal = dynamic(() => import('../../components/ui/AppModal'), { ssr: false });
import { AppModalType } from '../../components/ui/AppModal';
import { usePersistentSettings } from '../../hooks/usePersistentSettings';
import { requestNotificationPermission } from '../../lib/notifications';
import { cn } from '../../lib/utils';
import { mediaService } from '../../services/mediaService';
import { userService } from '../../services/userService';

const TOPIC_CATEGORIES = ["World News", "Tech", "Science", "Nature", "Story Mode", "Auto"];

const AVAILABLE_VOICES = [
  { id: 'Aoede', name: 'Aoede (Gemini Flash Native)' },
  { id: 'Charon', name: 'Charon (Gemini Flash Native)' },
  { id: 'Fenrir', name: 'Fenrir (Gemini Flash Native)' },
  { id: 'Kore', name: 'Kore (Gemini Flash Native)' },
  { id: 'Puck', name: 'Puck (Gemini Flash Native)' },
];

const DEFAULT_AUTO_UPLOAD_INTERVAL_HOURS = 2;
const DEFAULT_AUTO_UPLOAD_VIDEOS_PER_INTERVAL = 1;

type InputMode = 'topic' | 'prompt';
type ContentType = 'clips' | 'images' | 'mixed';
type CaptionPosition = 'top' | 'middle' | 'bottom';
type CaptionAnimation = 'fade' | 'slide_left' | 'slide_right' | 'pop' | 'none';

interface ChannelInputCacheEntry {
  inputMode?: InputMode;
  prompt?: string;
  selectedTopic?: string;
  customTopic?: string;
  storyMode?: boolean;
  storyId?: string;
  currentPart?: number;
  storyContext?: string;
  recapEnabled?: boolean;
  ctaEnabled?: boolean;
  duration?: number;
  contentType?: ContentType;
  videoCount?: number;
  selectedVoices?: string[];
  randomVoice?: boolean;
  templateFont?: string;
  templateColor?: string;
  captionPosition?: CaptionPosition;
  captionAnimation?: CaptionAnimation;
  maxWordsPerCaption?: number;
  useCustomMedia?: boolean;
  selectedThumbnailId?: string;
  scheduleEnabled?: boolean;
  scheduleDatetime?: string;
  autoUploadEnabled?: boolean;
  autoUploadIntervalHours?: number;
  autoUploadVideosPerInterval?: number;
}

interface YouTubeChannel {
  channelId: string;
  channelName: string;
  status?: string;
  isValid?: boolean;
}

interface DashboardUser {
  isYoutubeConnected?: boolean;
  youtubeChannels?: YouTubeChannel[];
  plan?: string;
  planFeatures?: {
    voice_selection?: boolean;
    scheduling?: boolean;
    multi_channel?: boolean;
    story_mode?: boolean;
    cta?: boolean;
    format_selection?: boolean;
    template_customization?: boolean;
    custom_media?: boolean;
  };
  uploadLimitPerDay?: number;
  uploadLimit?: number;
  remainingUploads?: number;
  user?: {
    plan?: string;
    templateFont?: string;
    templateColor?: string;
    lastSelectedChannelId?: string;
    lastChannelInputs?: Record<string, ChannelInputCacheEntry>;
    lastInputMode?: InputMode;
    lastPrompt?: string;
    lastSelectedTopic?: string;
    lastCustomTopic?: string;
  };
}

interface JobRecord {
  _id: string;
  status?: string;
  completedAt?: string;
  errorMessage?: string;
  error?: string;
  progress?: {
    progress?: number;
    stage?: string;
    message?: string;
    timestamp?: string;
  } | number;
}

interface MediaRecord {
  _id: string;
  type: 'video' | 'image' | 'thumbnail' | string;
  originalName?: string;
  duration?: number;
  imageDuration?: number;
  trimStart?: number;
  trimEnd?: number;
}

interface SequenceRecord {
  _id?: string;
  media?: MediaRecord | null;
}

interface AuthMeResponse {
  data: DashboardUser;
}

interface JobsResponse {
  data: JobRecord[];
}

interface MediaResponse {
  data: MediaRecord[];
}

interface SequenceResponse {
  data: SequenceRecord[];
}

interface PromptResponse {
  promptId?: string;
  gemini_prompt?: string;
  data?: {
    promptId?: string;
    id?: string;
    gemini_prompt?: string;
  };
}

interface PipelineResponse {
  warning?: string;
}

interface ApiErrorShape {
  message?: string;
  response?: {
    data?: {
      message?: string;
      warning?: string;
    };
  };
}

type DateTimePickerInput = HTMLInputElement & {
  showPicker?: () => void;
};

function Dashboard() {
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [mediaList, setMediaList] = useState<MediaRecord[]>([]);
  const [sequenceItems, setSequenceItems] = useState<SequenceRecord[]>([]);
  const [channelInputCache, setChannelInputCache] = useState<Record<string, ChannelInputCacheEntry>>({});

  // Persistent Settings
  const [inputMode, setInputMode] = usePersistentSettings<InputMode>('clipforge_inputMode', 'prompt');
  const [prompt, setPrompt] = usePersistentSettings<string>('clipforge_prompt', '');
  const [selectedTopic, setSelectedTopic] = usePersistentSettings<string>('clipforge_topic', 'Tech');
  const [customTopic, setCustomTopic] = usePersistentSettings<string>('clipforge_customTopic', '');

  const [duration, setDuration] = usePersistentSettings<number>('clipforge_duration', 60);
  const [contentType, setContentType] = usePersistentSettings<ContentType>('clipforge_contentType', 'mixed');
  const [videoCount, setVideoCount] = usePersistentSettings<number>('clipforge_videoCount', 1);

  // Story Mode State
  const [storyMode, setStoryMode] = usePersistentSettings<boolean>('clipforge_storyMode', false);
  const [currentPart, setCurrentPart] = usePersistentSettings<number>('clipforge_currentPart', 1);
  const [storyId, setStoryId] = usePersistentSettings<string>('clipforge_storyId', '');
  const [storyContext, setStoryContext] = usePersistentSettings<string>('clipforge_storyContext', '');
  const [recapEnabled, setRecapEnabled] = usePersistentSettings<boolean>('clipforge_recapEnabled', false);

  // Settings
  const [ctaEnabled, setCtaEnabled] = usePersistentSettings<boolean>('clipforge_ctaEnabled', false);
  const [selectedVoices, setSelectedVoices] = usePersistentSettings<string[]>('clipforge_voices', ['Aoede']);
  const [randomVoice, setRandomVoice] = usePersistentSettings<boolean>('clipforge_randomVoice', true);
  const [templateFont, setTemplateFont] = usePersistentSettings<string>('clipforge_templateFont', 'Arial');
  const [templateColor, setTemplateColor] = usePersistentSettings<string>('clipforge_templateColor', '#FFFFFF');
  const [captionPosition, setCaptionPosition] = usePersistentSettings<CaptionPosition>('clipforge_captionPosition', 'bottom');
  const [captionAnimation, setCaptionAnimation] = usePersistentSettings<CaptionAnimation>('clipforge_captionAnimation', 'fade');
  const [maxWordsPerCaption, setMaxWordsPerCaption] = usePersistentSettings<number>('clipforge_maxWordsPerCaption', 3);
  const [templateConfigOpen, setTemplateConfigOpen] = usePersistentSettings<boolean>('clipforge_templateConfigOpen', true);
  const [useCustomMedia, setUseCustomMedia] = usePersistentSettings<boolean>('clipforge_useCustomMedia', false);
  const [selectedThumbnailId, setSelectedThumbnailId] = usePersistentSettings<string>('clipforge_selectedThumbnailId', '');

  // Scheduling State
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(false);
  const [scheduleDatetime, setScheduleDatetime] = useState<string>('');
  const scheduleInputRef = useRef<HTMLInputElement | null>(null);
  const [autoUploadEnabled, setAutoUploadEnabled] = usePersistentSettings<boolean>('clipforge_autoUploadEnabled', false);
  const [autoUploadIntervalHours, setAutoUploadIntervalHours] = usePersistentSettings<number>('clipforge_autoUploadIntervalHours', 2);
  const [autoUploadVideosPerInterval, setAutoUploadVideosPerInterval] = usePersistentSettings<number>('clipforge_autoUploadVideosPerInterval', 1);

  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);
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

  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [pendingPromptContent, setPendingPromptContent] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const paymentConfirmingRef = useRef(false);
  const jobStatusRef = useRef<Record<string, string>>({});
  const notificationsPrimedRef = useRef(false);
  const allYouTubeChannels = Array.isArray(user?.youtubeChannels) ? user.youtubeChannels : [];
  const activeYouTubeChannels = allYouTubeChannels.filter((channel) => channel?.status !== 'disabled_due_to_plan');
  const validYouTubeChannels = activeYouTubeChannels.filter((channel) => channel?.isValid !== false);
  const invalidYouTubeChannels = activeYouTubeChannels.filter((channel) => channel?.isValid === false);
  const selectedChannelInvalid = selectedChannelId
    ? invalidYouTubeChannels.some((channel) => channel?.channelId === selectedChannelId)
    : false;
  const reconnectChannelsToShow = selectedChannelInvalid
    ? invalidYouTubeChannels.filter((channel) => channel?.channelId === selectedChannelId)
    : (validYouTubeChannels.length === 0 ? invalidYouTubeChannels : []);

  const getCurrentChannelCacheEntry = useCallback((): ChannelInputCacheEntry => ({
    inputMode,
    prompt,
    selectedTopic,
    customTopic,
    storyMode,
    storyId,
    currentPart,
    storyContext,
    recapEnabled,
    ctaEnabled,
    duration,
    contentType,
    videoCount,
    selectedVoices,
    randomVoice,
    templateFont,
    templateColor,
    captionPosition,
    captionAnimation,
    maxWordsPerCaption,
    useCustomMedia,
    selectedThumbnailId,
    scheduleEnabled,
    scheduleDatetime,
    autoUploadEnabled,
    autoUploadIntervalHours,
    autoUploadVideosPerInterval,
  }), [
    inputMode,
    prompt,
    selectedTopic,
    customTopic,
    storyMode,
    storyId,
    currentPart,
    storyContext,
    recapEnabled,
    ctaEnabled,
    duration,
    contentType,
    videoCount,
    selectedVoices,
    randomVoice,
    templateFont,
    templateColor,
    captionPosition,
    captionAnimation,
    maxWordsPerCaption,
    useCustomMedia,
    selectedThumbnailId,
    scheduleEnabled,
    scheduleDatetime,
    autoUploadEnabled,
    autoUploadIntervalHours,
    autoUploadVideosPerInterval,
  ]);

  const applyChannelCache = useCallback((cached?: ChannelInputCacheEntry) => {
    setInputMode(cached?.inputMode || 'prompt');
    setPrompt(cached?.prompt ?? '');
    setSelectedTopic(cached?.selectedTopic || 'Tech');
    setCustomTopic(cached?.customTopic ?? '');

    setStoryMode(Boolean(cached?.storyMode));
    setStoryId(cached?.storyId || '');
    const partCandidate = Number(cached?.currentPart);
    setCurrentPart(Number.isFinite(partCandidate) && partCandidate > 0 ? Math.floor(partCandidate) : 1);
    setStoryContext(cached?.storyContext ?? '');
    setRecapEnabled(Boolean(cached?.recapEnabled));
    setCtaEnabled(Boolean(cached?.ctaEnabled));

    const durationCandidate = Number(cached?.duration);
    setDuration(
      Number.isFinite(durationCandidate)
        ? Math.min(120, Math.max(15, Math.round(durationCandidate)))
        : 60
    );
    setContentType(cached?.contentType || 'mixed');
    const videoCountCandidate = Number(cached?.videoCount);
    setVideoCount(
      Number.isFinite(videoCountCandidate)
        ? Math.min(10, Math.max(1, Math.round(videoCountCandidate)))
        : 1
    );

    const cachedVoices = Array.isArray(cached?.selectedVoices)
      ? cached?.selectedVoices.filter(Boolean)
      : [];
    setSelectedVoices(cachedVoices.length ? cachedVoices : ['Aoede']);
    setRandomVoice(Boolean(cached?.randomVoice));

    setTemplateFont(cached?.templateFont || 'Arial');
    setTemplateColor(cached?.templateColor || '#FFFFFF');
    setCaptionPosition(cached?.captionPosition || 'bottom');
    setCaptionAnimation(
      cached?.captionAnimation === 'slide_left' ||
      cached?.captionAnimation === 'slide_right' ||
      cached?.captionAnimation === 'pop' ||
      cached?.captionAnimation === 'none' ||
      cached?.captionAnimation === 'fade'
        ? cached.captionAnimation
        : 'fade'
    );
    const wordsCandidate = Number(cached?.maxWordsPerCaption);
    setMaxWordsPerCaption(
      Number.isFinite(wordsCandidate)
        ? Math.min(8, Math.max(1, Math.round(wordsCandidate)))
        : 3
    );
    setUseCustomMedia(Boolean(cached?.useCustomMedia));
    setSelectedThumbnailId(cached?.selectedThumbnailId || '');

    const nextAutoUploadEnabled = Boolean(cached?.autoUploadEnabled);
    const nextScheduleEnabled = Boolean(cached?.scheduleEnabled) && !nextAutoUploadEnabled;
    const intervalCandidate = Number(cached?.autoUploadIntervalHours);
    const videosCandidate = Number(cached?.autoUploadVideosPerInterval);

    setAutoUploadEnabled(nextAutoUploadEnabled);
    setScheduleEnabled(nextScheduleEnabled);
    setScheduleDatetime(cached?.scheduleDatetime || '');
    setAutoUploadIntervalHours(
      Number.isFinite(intervalCandidate)
        ? Math.min(24, Math.max(1, intervalCandidate))
        : DEFAULT_AUTO_UPLOAD_INTERVAL_HOURS
    );
    setAutoUploadVideosPerInterval(
      Number.isFinite(videosCandidate)
        ? Math.min(10, Math.max(1, videosCandidate))
        : DEFAULT_AUTO_UPLOAD_VIDEOS_PER_INTERVAL
    );
  }, [
    setInputMode,
    setPrompt,
    setSelectedTopic,
    setCustomTopic,
    setStoryMode,
    setStoryId,
    setCurrentPart,
    setStoryContext,
    setRecapEnabled,
    setCtaEnabled,
    setDuration,
    setContentType,
    setVideoCount,
    setSelectedVoices,
    setRandomVoice,
    setTemplateFont,
    setTemplateColor,
    setCaptionPosition,
    setCaptionAnimation,
    setMaxWordsPerCaption,
    setUseCustomMedia,
    setSelectedThumbnailId,
    setAutoUploadEnabled,
    setScheduleEnabled,
    setScheduleDatetime,
    setAutoUploadIntervalHours,
    setAutoUploadVideosPerInterval,
  ]);

  const switchChannel = useCallback((nextChannelId: string) => {
    const currentId = selectedChannelId;
    const nextCache = { ...channelInputCache };

    if (currentId) {
      nextCache[currentId] = getCurrentChannelCacheEntry();
    }

    setChannelInputCache(nextCache);
    setSelectedChannelId(nextChannelId);
    applyChannelCache(nextCache[nextChannelId]);
    userService.updateSettings({ lastChannelInputs: nextCache, lastSelectedChannelId: nextChannelId }).catch(() => {});
  }, [selectedChannelId, channelInputCache, getCurrentChannelCacheEntry, applyChannelCache]);

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      if (paymentConfirmingRef.current) return;
      paymentConfirmingRef.current = true;
      (async () => {
        try {
          const params = Object.fromEntries(searchParams.entries());
          await paymentService.confirmPayment(params as Record<string, string>);
          const userData = await authService.getMe() as AuthMeResponse;
          setUser({ ...userData.data, ...userData.data.user });
          setMessage({ text: 'Subscription upgraded successfully! Your limits have been updated.', type: 'success' });
        } catch {
          setMessage({ text: 'Payment received, but verification is pending. Please refresh in a minute or contact support.', type: 'warning' });
        } finally {
          router.replace('/dashboard');
        }
      })();
    }
  }, [searchParams, router]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [userResult, jobsResult, mediaResult, sequenceResult] = await Promise.allSettled([
          authService.getMe(),
          pipelineService.getJobs(),
          mediaService.getMedia(),
          mediaService.getSequence()
        ]);

        if (userResult.status === 'fulfilled') {
          const userData = userResult.value as AuthMeResponse;
          setUser({ ...userData.data, ...userData.data.user });

          if (userData.data?.user?.templateFont) {
            setTemplateFont(userData.data.user.templateFont);
          }
          if (userData.data?.user?.templateColor) {
            setTemplateColor(userData.data.user.templateColor);
          }
          if (userData.data?.user?.lastChannelInputs) {
            setChannelInputCache(userData.data.user.lastChannelInputs);
          }
          if (userData.data?.user?.lastInputMode) {
            setInputMode(userData.data.user.lastInputMode);
          }
          if (userData.data?.user?.lastPrompt !== undefined) {
            setPrompt(userData.data.user.lastPrompt);
          }
          if (userData.data?.user?.lastSelectedTopic) {
            setSelectedTopic(userData.data.user.lastSelectedTopic);
          }
          if (userData.data?.user?.lastCustomTopic !== undefined) {
            setCustomTopic(userData.data.user.lastCustomTopic);
          }

          const validChannels = Array.isArray(userData.data?.youtubeChannels)
            ? userData.data.youtubeChannels.filter((channel) => channel?.status !== 'disabled_due_to_plan' && channel?.isValid !== false)
            : [];
          const preferredChannelId = String(userData.data?.user?.lastSelectedChannelId || '').trim();
          const initialChannelId = (preferredChannelId && validChannels.some((channel) => channel?.channelId === preferredChannelId))
            ? preferredChannelId
            : (validChannels[0]?.channelId || '');
          if (initialChannelId) {
            setSelectedChannelId(initialChannelId);
            const cached = userData.data?.user?.lastChannelInputs?.[initialChannelId];
            applyChannelCache(cached);
          }
        } else {
          throw userResult.reason; // Rethrow to handle auth error below
        }

        if (jobsResult.status === 'fulfilled') {
          const jobsData = jobsResult.value as JobsResponse;
          setJobs(jobsData.data || []);
        }

        if (mediaResult.status === 'fulfilled') {
          const mediaData = mediaResult.value as MediaResponse;
          setMediaList(mediaData.data || []);
        }

        if (sequenceResult.status === 'fulfilled') {
          const sequenceData = sequenceResult.value as SequenceResponse;
          setSequenceItems(sequenceData.data || []);
        } else {
          setSequenceItems([]);
        }

        // Parse URL params for auth callback errors
        const urlParams = new URLSearchParams(window.location.search);
        const urlError = urlParams.get('error');
        if (urlError === 'channel_limit_reached') {
            setModalConfig({
                isOpen: true,
                title: 'Channel Limit Reached',
                description: 'You have reached the maximum number of connected YouTube channels allowed for your current plan. Please upgrade to connect more.',
                type: 'error',
                confirmText: 'Upgrade',
                onConfirm: () => {
                    window.location.href = '/settings';
                },
                cancelText: 'Close',
                onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
            });
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (urlError === 'reconnect_channel_mismatch') {
            setModalConfig({
                isOpen: true,
                title: 'Reconnect Failed',
                description: 'You selected a different Google account. Please reconnect using the same YouTube channel.',
                type: 'error',
                confirmText: 'Close',
                onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
            });
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // Request notification permission once user is loaded
        requestNotificationPermission();
      } catch (err) {
        authService.handleAuthError(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [setCustomTopic, setInputMode, setPrompt, setSelectedTopic, setTemplateColor, setTemplateFont, applyChannelCache]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let pollingDelayMs = 10000; // FIXED: Start polling at 10s.

    const activeStatuses = new Set(['pending', 'processing', 'queued', 'running']);
    const terminalStatuses = new Set(['success', 'completed', 'failed', 'cancelled', 'canceled']);
    const runtimeStages = new Set([
      'processing',
      'dispatch',
      'content_load',
      'content_generation',
      'payload_build',
      'token_validation',
      'pipeline_runtime',
      'upload_confirmation_pending',
    ]);

    const isRuntimeInFlight = (job: JobRecord) => {
      const progressValue = typeof job.progress === 'number'
        ? job.progress
        : (typeof job.progress === 'object' ? Number(job.progress?.progress || 0) : 0);
      const stage = String(typeof job.progress === 'object' ? (job.progress?.stage || '') : '').toLowerCase();
      return Number.isFinite(progressValue) && progressValue >= 0 && progressValue < 100 && runtimeStages.has(stage);
    };

    const getEffectiveStatus = (job: JobRecord) => {
      const normalized = String(job.status || '').toLowerCase();
      if (activeStatuses.has(normalized) && isRuntimeInFlight(job)) {
        return 'processing';
      }
      return normalized;
    };

    const scheduleNextPoll = () => {
      if (cancelled) {
        return;
      }
      timeoutHandle = setTimeout(pollJobs, pollingDelayMs);
    };

    const pollJobs = async () => {
      if (document.hidden) {
        pollingDelayMs = Math.max(pollingDelayMs, 30000);
        scheduleNextPoll();
        return;
      }
      try {
        const jobsData = await pipelineService.getJobs() as JobsResponse;
        const currentJobs = jobsData.data || [];
        const nextStatusMap: Record<string, string> = {};

        for (const job of currentJobs) {
          nextStatusMap[job._id] = getEffectiveStatus(job);
        }

        const hasActiveJobs = currentJobs.some((job) => activeStatuses.has(getEffectiveStatus(job)));

        if (!notificationsPrimedRef.current) {
          // Prime with current snapshot so old completed/failed jobs don't trigger popups.
          jobStatusRef.current = nextStatusMap;
          notificationsPrimedRef.current = true;
          setJobs(currentJobs);
          pollingDelayMs = hasActiveJobs ? 10000 : 30000;
          scheduleNextPoll();
          return;
        }

        const prevStatusMap = jobStatusRef.current;
        let resetBackoff = false;

        for (const job of currentJobs) {
          const prevStatus = (prevStatusMap[job._id] || '').toLowerCase();
          const currStatus = String(nextStatusMap[job._id] || '').toLowerCase();
          const wasActive = activeStatuses.has(prevStatus);
          const isTerminal = terminalStatuses.has(currStatus);
          const isSuccess = currStatus === 'success' || currStatus === 'completed';
          const isFailed = currStatus === 'failed';

          // Notify only on real state transition from active -> terminal.
          if (wasActive && isTerminal) {
            resetBackoff = true; // FIXED: Reset polling delay on active->terminal transitions.
            if (isSuccess) {
              setModalConfig({
                isOpen: true,
                title: 'Job Completed',
                description: 'Your video generation and upload has completed successfully!',
                type: 'success',
                confirmText: 'Awesome',
                onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
              });
            } else if (isFailed) {
              setModalConfig({
                isOpen: true,
                title: 'Job Failed',
                description: 'A background job failed to complete. You can view the logs in your history.',
                type: 'error',
                confirmText: 'Dismiss',
                onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
              });
            }
          }
        }

        jobStatusRef.current = nextStatusMap;
        setJobs(currentJobs);

        if (!hasActiveJobs) {
          pollingDelayMs = Math.max(pollingDelayMs, 30000);
        } else {
          pollingDelayMs = resetBackoff ? 10000 : Math.min(pollingDelayMs + 2000, 30000);
        }
      } catch {
        // Silently ignore polling errors and back off to avoid request storms.
        pollingDelayMs = Math.min(pollingDelayMs + 2000, 30000); // FIXED: Back off on polling failures.
      }

      scheduleNextPoll();
    };

    void pollJobs();

    return () => {
      cancelled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };
  }, [user]);

  useEffect(() => {
    if (!user?.isYoutubeConnected) {
      if (selectedChannelId) {
        setSelectedChannelId('');
      }
      return;
    }
    if (validYouTubeChannels.length === 0) {
      if (selectedChannelId) {
        setSelectedChannelId('');
      }
      return;
    }
    const isSelectedValid = validYouTubeChannels.some((channel) => channel.channelId === selectedChannelId);
    if (!isSelectedValid) {
      const fallbackChannelId = validYouTubeChannels[0]?.channelId || '';
      setSelectedChannelId(fallbackChannelId);
      if (fallbackChannelId) {
        applyChannelCache(channelInputCache[fallbackChannelId]);
      }
    }
  }, [user?.isYoutubeConnected, validYouTubeChannels, selectedChannelId, applyChannelCache, channelInputCache]);

  const currentPlan = ((user?.plan || user?.user?.plan || 'free') as string).toLowerCase();
  const planFeatures = (user?.planFeatures || {}) as {
    voice_selection?: boolean;
    scheduling?: boolean;
    multi_channel?: boolean;
    story_mode?: boolean;
    cta?: boolean;
    format_selection?: boolean;
    template_customization?: boolean;
    custom_media?: boolean;
  };
  const isFreeUser = currentPlan === 'free';
  const isPaidPlan = !isFreeUser;
  const canUseVoiceSelection = planFeatures.voice_selection ?? isPaidPlan;
  const canUseScheduling = planFeatures.scheduling ?? isPaidPlan;
  const canUseStoryMode = planFeatures.story_mode ?? isPaidPlan;
  const canUseCta = planFeatures.cta ?? isPaidPlan;
  const canUseFormatSelection = planFeatures.format_selection ?? isPaidPlan;
  const canUseTemplateCustomization = planFeatures.template_customization ?? false;
  const canUseCustomMedia = planFeatures.custom_media ?? false;
  const effectiveStoryMode = canUseStoryMode && storyMode;
  const uploadLimitPerDay = user?.uploadLimitPerDay ?? user?.uploadLimit ?? 0;
  const remainingUploads = user?.remainingUploads ?? 0;
  const remainingPct = uploadLimitPerDay > 0 ? remainingUploads / uploadLimitPerDay : 0;
  const remainingColor = remainingUploads === 0
    ? 'text-red-400'
    : remainingPct <= 0.1
      ? 'text-orange-400'
      : 'text-green-400';
  const sequenceList = sequenceItems.filter(item => item?.media);
  const sequenceVideoCount = sequenceList.filter(item => item.media?.type === 'video').length;
  const sequenceImageCount = sequenceList.filter(item => item.media?.type === 'image').length;
  const sequenceTotalDuration = Math.round(sequenceList.reduce((acc, item) => {
    const mediaItem = item?.media;
    if (!mediaItem) return acc;
    if (mediaItem.type === 'image') {
      return acc + (mediaItem.imageDuration || 3);
    }
    const duration = mediaItem.duration || 0;
    const trimStart = mediaItem.trimStart || 0;
    const trimEnd = mediaItem.trimEnd ?? duration;
    const clipDuration = Math.max(0, (trimEnd || 0) - (trimStart || 0));
    return acc + clipDuration;
  }, 0));

  useEffect(() => {
    if (!canUseStoryMode && storyMode) {
      setStoryMode(false);
    }
    if (!canUseStoryMode && recapEnabled) {
      setRecapEnabled(false);
    }
    if (!canUseScheduling && autoUploadEnabled) {
      setAutoUploadEnabled(false);
    }
    if (!canUseScheduling && scheduleEnabled) {
      setScheduleEnabled(false);
    }
  }, [canUseStoryMode, canUseScheduling, storyMode, recapEnabled, autoUploadEnabled, scheduleEnabled, setStoryMode, setRecapEnabled, setAutoUploadEnabled]);

  const handleConnectYouTube = useCallback(() => {
    (async () => {
      const url = await youtubeService.getAuthUrl();
      window.location.href = url;
    })();
  }, []);

  const handleReconnectChannel = useCallback((channelId: string) => {
    (async () => {
      const url = await youtubeService.getAuthUrl(channelId);
      window.location.href = url;
    })();
  }, []);

  const resetStoryProgress = () => {
    setCurrentPart(1);
    setStoryId('');
    setStoryContext('');
  };

  const confirmStoryReset = (onConfirm: () => void) => {
    const shouldConfirm = effectiveStoryMode && (currentPart > 1 || !!storyContext || !!storyId);
    if (!shouldConfirm) {
      onConfirm();
      return;
    }
    setModalConfig({
      isOpen: true,
      title: 'Reset Story Progress?',
      description: 'Changing the prompt or topic will reset your story progress and you won\'t be able to continue the current story.',
      type: 'warning',
      confirmText: 'Reset & Continue',
      cancelText: 'Cancel',
      onConfirm: () => {
        resetStoryProgress();
        setModalConfig(prev => ({ ...prev, isOpen: false }));
        onConfirm();
      },
      onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
    });
  };

  const handleUpgrade = useCallback(async () => {
    router.push('/pricing');
  }, [router]);

  const showUpgradeModal = useCallback((featureLabel?: string) => {
    setModalConfig({
      isOpen: true,
      title: 'Upgrade Required',
      description: featureLabel
        ? `${featureLabel} is not included in your plan. Upgrade your plan to use this feature.`
        : 'This privilege is not included in your plan. Upgrade your plan to use this feature.',
      type: 'warning',
      confirmText: 'Upgrade',
      cancelText: 'Dismiss',
      onConfirm: () => {
        setModalConfig(prev => ({ ...prev, isOpen: false }));
        router.push('/pricing');
      },
      onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
    });
  }, [router]);

  const handleVoiceToggle = useCallback((vid: string) => {
    if (!canUseVoiceSelection) {
      showUpgradeModal('Voice selection');
      return;
    }
    if (randomVoice) setRandomVoice(false);
    setSelectedVoices(prev =>
      prev.includes(vid) ? prev.filter(id => id !== vid) : [...prev, vid]
    );
  }, [canUseVoiceSelection, randomVoice, showUpgradeModal, setRandomVoice, setSelectedVoices]);

  const playVoicePreview = (e: React.MouseEvent, voiceName: string) => {
    e.stopPropagation();
    // Mock play functionality
    console.log(`Playing sample for ${voiceName}...`);
  };

  const handleGenerateAndRun = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitEvent = e.nativeEvent as SubmitEvent;
    const submitter = submitEvent?.submitter as HTMLButtonElement | null;
    if (submitter && submitter.id !== 'generate-pipeline-btn') {
      return;
    }

    // Prevent double entry
    if (generating) return;

    if (!user?.isYoutubeConnected) {
      setModalConfig({
        isOpen: true,
        title: 'Connection Required',
        description: 'Please connect your YouTube channel first before generating videos.',
        type: 'error',
        confirmText: 'Connect Now',
        onConfirm: () => {
          setModalConfig(prev => ({ ...prev, isOpen: false }));
          handleConnectYouTube();
        },
        cancelText: 'Cancel',
        onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
      return;
    }

    if (!selectedChannelId || validYouTubeChannels.length === 0) {
      const reconnectTarget = reconnectChannelsToShow[0]?.channelId || '';
      setModalConfig({
        isOpen: true,
        title: 'Valid Channel Required',
        description: reconnectTarget
          ? 'Your connected channel token is expired. Reconnect that channel before starting generation.'
          : 'Please select a connected YouTube channel first.',
        type: 'error',
        confirmText: reconnectTarget ? 'Reconnect' : 'Close',
        onConfirm: () => {
          setModalConfig(prev => ({ ...prev, isOpen: false }));
          if (reconnectTarget) {
            handleReconnectChannel(reconnectTarget);
          }
        },
        cancelText: 'Cancel',
        onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
      return;
    }

    if (inputMode === 'prompt' && !prompt.trim()) {
      setMessage({ text: 'Please enter a prompt idea.', type: 'error' });
      return;
    }

    if (inputMode === 'topic' && selectedTopic === 'Custom' && !customTopic.trim()) {
      setMessage({ text: 'Please enter a custom topic.', type: 'error' });
      return;
    }

    // Strict upload limit enforcement before hitting backend
    const remainingUploads = user?.remainingUploads;
    if (typeof remainingUploads === 'number' && remainingUploads < videoCount) {
      setMessage({ text: `Not enough uploads remaining. You requested ${videoCount} videos but only have ${remainingUploads} uploads available today.`, type: 'error' });
      return;
    }

    if (videoCount >= 7) {
      setModalConfig({
         isOpen: true,
         title: 'High Volume Warning',
         description: `You are requesting ${videoCount} videos at once. This is a high volume and may take significant time to process. Do you want to proceed?`,
         type: 'warning',
         confirmText: 'Proceed',
         cancelText: 'Cancel',
         onConfirm: () => {
             setModalConfig(prev => ({ ...prev, isOpen: false }));
             runPipelineGeneration();
         },
         onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
      });
      return;
    }

    runPipelineGeneration();
  };

    const runPipelineGeneration = async () => {
      setGenerating(true);
      setMessage(null);
      try {
        try {
          const updatedCache = selectedChannelId
            ? {
                ...channelInputCache,
                [selectedChannelId]: getCurrentChannelCacheEntry(),
              }
            : channelInputCache;
          await userService.updateSettings({
            lastInputMode: inputMode,
            lastSelectedChannelId: selectedChannelId,
            lastPrompt: prompt,
            lastSelectedTopic: selectedTopic,
            lastCustomTopic: customTopic,
            lastChannelInputs: updatedCache,
          });
          if (selectedChannelId) setChannelInputCache(updatedCache);
        } catch {}
        // 1. Manage Story ID
        let currentStoryId = storyId;
      if (effectiveStoryMode && currentPart === 1) {
        currentStoryId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        setStoryId(currentStoryId);
      }

      // 2. Construct the final prompt to pass to Gemini
      let finalPrompt = '';
      if (inputMode === 'prompt') {
        finalPrompt = prompt;
      } else {
        const topicString = selectedTopic === 'Custom' ? customTopic : selectedTopic;
        finalPrompt = `Create a viral short-form video about the topic: ${topicString}.`;
      }

      if (effectiveStoryMode) {
        finalPrompt += ` This is Part ${currentPart} of an ongoing series.`;

        if (storyContext) {
          finalPrompt += `\n\nContext from previous parts: ${storyContext}`;
        }

        if (recapEnabled && currentPart > 1) {
          finalPrompt += `\nBegin this video with a brief recap of the previous parts.`;
        }
      }

      if (ctaEnabled) {
        finalPrompt += `\nInclude a strong, dynamic call-to-action at the end related to the content to subscribe and like the video.`;
      }

      const promptRes = await promptService.generatePrompt(finalPrompt) as PromptResponse;
      const promptId =
        promptRes?.promptId ||
        promptRes?.data?.promptId ||
        promptRes?.data?.id ||
        '';
      if (!promptId) {
        throw new Error('Prompt generation response is missing promptId');
      }

      await executePipeline(
        promptId,
        false,
        promptRes?.gemini_prompt || promptRes?.data?.gemini_prompt,
        currentStoryId
      );
    } catch (err: unknown) {
      console.error(err);
      const apiError = err as ApiErrorShape;
      const warningMessage = apiError.response?.data?.warning;
      if (warningMessage) {
        const isYouTubeLimitWarning = /youtube\s+daily\s+upload\s+limit/i.test(warningMessage);
        setModalConfig({
          isOpen: true,
          title: isYouTubeLimitWarning ? 'YouTube Daily Upload Limit Reached' : 'Limit Warning',
          description: warningMessage,
          type: 'warning',
          confirmText: 'Proceed Anyway',
          cancelText: 'Cancel',
          onConfirm: () => handleConfirmWarning(),
          onCancel: () => handleCancelWarning(),
        });
      } else {
        handleApiError(err);
      }
      setGenerating(false);
    }
  };

  const handleApiError = (err: unknown) => {
     const apiError = err as ApiErrorShape;
     const errorMsg = apiError.response?.data?.message || apiError.message || 'An unknown error occurred.';
     const isConcurrencyLimitError = /maximum\s+concurrent\s+(jobs|pipelines)\s+reached/i.test(errorMsg);
     const isUploadQuotaError =
       errorMsg.includes('videos running/pending') ||
       errorMsg.includes('Not enough uploads remaining') ||
       errorMsg.includes('exceeds the strict limit');

     if (errorMsg.includes('youtube_token_expired') || errorMsg.includes('YouTube channel is not connected or token is invalid')) {
         const reconnectTarget = reconnectChannelsToShow[0]?.channelId || selectedChannelId || invalidYouTubeChannels[0]?.channelId || '';
         setModalConfig({
             isOpen: true,
             title: 'YouTube Reconnect Required',
             description: 'Your YouTube token has expired or is invalid. Please reconnect your account to continue.',
             type: 'error',
             confirmText: 'Reconnect',
             onConfirm: () => reconnectTarget ? handleReconnectChannel(reconnectTarget) : handleConnectYouTube(),
             cancelText: 'Close',
             onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
         });
         } else if (isConcurrencyLimitError) {
           setModalConfig({
             isOpen: true,
             title: 'Pipeline Limit Reached',
             description: `${errorMsg} Please wait for one running job to finish, then try again.`,
             type: 'warning',
             confirmText: 'OK',
             onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
             cancelText: 'Dismiss',
             onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
           });
         } else if (isUploadQuotaError) {
         setModalConfig({
             isOpen: true,
             title: 'Upload Limit Reached',
             description: errorMsg,
             type: 'error',
             confirmText: 'Upgrade Plan',
             onConfirm: () => {
                window.location.href = '/pricing';
             },
             cancelText: 'Dismiss',
             onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
         });
     } else {
         setModalConfig({
             isOpen: true,
             title: 'Action Failed',
             description: errorMsg,
             type: 'error',
             confirmText: 'Dismiss',
             onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
         });
     }
  };

  const handleStoryModeToggle = () => {
    if (!canUseStoryMode) {
      showUpgradeModal('Story Mode');
      return;
    }
    setStoryMode(!storyMode);
  };

  const executePipeline = async (pId: string, acceptedWarning: boolean, newPromptContent?: string, executeStoryId?: string) => {
    try {
      if (acceptedWarning) {
          setGenerating(true);
      }
      const normalizedMaxWordsPerCaption = Math.max(1, Math.min(8, Math.round(maxWordsPerCaption || 3)));
      let finalVoices = selectedVoices;
      if (randomVoice && AVAILABLE_VOICES.length > 0) {
        finalVoices = [AVAILABLE_VOICES[Math.floor(Math.random() * AVAILABLE_VOICES.length)]!.id];
      }

      const videoConfig = {
        targetDuration: duration,
        contentType,
        videoCount,
        channelId: selectedChannelId,
        upload: true,
        publishNow: true,
        storyMode: effectiveStoryMode,
        storyId: executeStoryId || storyId,
        currentPart,
        recapEnabled: effectiveStoryMode && currentPart > 1 ? recapEnabled : false,
        ctaEnabled,
        voices: finalVoices,
        templateConfig: {
          fontStyle: templateFont,
          subtitleColor: templateColor,
          captionPosition,
          captionAnimation,
          maxWordsPerCaption: normalizedMaxWordsPerCaption,
        },
        customVideoIds: useCustomMedia ? mediaList.filter(m => m.type === 'video').map(m => m._id) : [],
        customImageIds: useCustomMedia ? mediaList.filter(m => m.type === 'image').map(m => m._id) : [],
        customThumbnailId: useCustomMedia && selectedThumbnailId ? selectedThumbnailId : undefined
      };

      if (autoUploadEnabled) {
        if (!canUseScheduling) {
          showUpgradeModal('Auto-upload scheduling');
          return;
        }

        if (!autoUploadIntervalHours || autoUploadIntervalHours < 1) {
          setMessage({ text: 'Please set a valid interval (in hours).', type: 'error' });
          return;
        }

        if (!autoUploadVideosPerInterval || autoUploadVideosPerInterval < 1) {
          setMessage({ text: 'Please set a valid videos per interval count.', type: 'error' });
          return;
        }

        await scheduleService.createSchedule({
          channelId: selectedChannelId,
          type: 'interval',
          intervalHours: autoUploadIntervalHours,
          videosPerInterval: autoUploadVideosPerInterval,
          videoConfig: { ...videoConfig, promptId: pId, videoCount: autoUploadVideosPerInterval },
        });
        setMessage({ text: 'Auto-upload schedule created successfully!', type: 'success' });
      } else if (scheduleEnabled) {
        if (!scheduleDatetime) {
          setMessage({ text: 'Please select a publish date and time for the scheduled run.', type: 'error' });
          return;
        }
        if (!canUseScheduling) {
          showUpgradeModal('Scheduling');
          return;
        }
        await scheduleService.createSchedule({
          channelId: selectedChannelId,
          type: 'one-time',
          datetime: new Date(scheduleDatetime),
          videoConfig: { ...videoConfig, promptId: pId }
        });
        setMessage({ text: 'Video generation scheduled successfully!', type: 'success' });
      } else {
        const pipelineRes = await pipelineService.runPipeline(pId, videoConfig, acceptedWarning) as PipelineResponse;
        if (pipelineRes.warning) {
            setMessage({ text: pipelineRes.warning, type: 'warning' });
        } else {
            setMessage({ text: 'Pipeline started successfully!', type: 'success' });
        }
      }

      // If story mode, save context for the next part and increment
      if (effectiveStoryMode) {
        setStoryContext(prevContext => {
          // ensure we only append the newly generated content, not the prompt with previous context already injected
          const newContext = newPromptContent || (inputMode === 'prompt' ? prompt : `Video about: ${selectedTopic === 'Custom' ? customTopic : selectedTopic}`);
          return prevContext ? `${prevContext}\n\n[Part ${currentPart}]: ${newContext}` : `[Part 1]: ${newContext}`;
        });
        setCurrentPart(prev => prev + 1);
      }

      const jobsData = await pipelineService.getJobs() as JobsResponse;
      setJobs(jobsData.data);
      setModalConfig(prev => ({ ...prev, isOpen: false }));
      setPendingPromptId(null);
      setPendingPromptContent(null);
    } catch (err: unknown) {
      console.error(err);
      const apiError = err as ApiErrorShape;
      const warningMessage = apiError.response?.data?.warning;
      if (warningMessage) {
        const isYouTubeLimitWarning = /youtube\s+daily\s+upload\s+limit/i.test(warningMessage);
         setPendingPromptId(pId);
         setPendingPromptContent(newPromptContent || null);
         setModalConfig({
            isOpen: true,
          title: isYouTubeLimitWarning ? 'YouTube Daily Upload Limit Reached' : 'Limit Warning',
            description: warningMessage,
            type: 'warning',
            confirmText: 'Proceed Anyway',
            cancelText: 'Cancel',
            onConfirm: () => handleConfirmWarning(),
            onCancel: () => handleCancelWarning(),
         });
      } else {
         handleApiError(err);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirmWarning = async () => {
     if (pendingPromptId) {
         await executePipeline(pendingPromptId, true, pendingPromptContent || undefined, storyId);
     }
  };

  const handleCancelWarning = () => {
     setModalConfig(prev => ({ ...prev, isOpen: false }));
     setPendingPromptId(null);
     setPendingPromptContent(null);
  };

  if (loading) {
    return (
      <DashboardLayout user={user}>
        <div className="space-y-6">
          <div className="flex items-center space-x-3 text-slate-400 text-sm">
            <RefreshCw className="h-4 w-4 animate-spin text-[#7C5CFF]" />
            <span>Loading dashboard…</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <div className="bg-[#111827] border border-[#1A2235] rounded-2xl p-3 sm:p-6 shadow-xl">
                <div className="h-6 w-40 bg-[#1A2235] rounded mb-6" />
                <div className="h-24 bg-[#0B0F1A] border border-[#1A2235] rounded-xl" />
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="h-20 bg-[#0B0F1A] border border-[#1A2235] rounded-xl" />
                  <div className="h-20 bg-[#0B0F1A] border border-[#1A2235] rounded-xl" />
                  <div className="h-20 bg-[#0B0F1A] border border-[#1A2235] rounded-xl" />
                </div>
              </div>
            </div>
            <div className="space-y-6">
              <div className="bg-[#111827] border border-[#1A2235] rounded-2xl p-3 sm:p-6 shadow-xl">
                <div className="h-5 w-28 bg-[#1A2235] rounded mb-4" />
                <div className="h-20 bg-[#0B0F1A] border border-[#1A2235] rounded-xl" />
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }


  return (
    <DashboardLayout user={user}>

      <AnimatePresence>
        {message && (
          <m.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`p-4 rounded-xl border flex items-start space-x-3 ${
              message.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
              message.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' :
              'bg-[#00D4FF]/10 border-[#00D4FF]/20 text-[#00D4FF]'
            }`}
          >
            <ShieldAlert className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm font-medium">{message.text}</span>
          </m.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Left Column: Form */}
        <div className="xl:col-span-2 space-y-6">

          <m.div whileHover={{ scale: 1.002 }} className="bg-[#111827] border border-[#1A2235] rounded-2xl p-3 sm:p-6 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-6 border-b border-[#1A2235] pb-4">
                <div className="flex items-center">
                  <div className="h-10 w-10 bg-[#7C5CFF]/10 rounded-xl flex items-center justify-center mr-4 border border-[#7C5CFF]/20 shadow-glow-primary">
                    <Sparkles className="h-5 w-5 text-[#00D4FF]" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-tight">Generation Engine</h2>
                  </div>
                </div>

                {/* Input Mode Toggle (Desktop) */}
                <div className="hidden sm:flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => router.push('/media')}
                    className="flex items-center px-4 py-1.5 rounded-lg text-sm font-bold bg-white/5 text-white hover:bg-white/10 border border-white/10 transition-colors shadow-sm"
                  >
                    Media Library
                  </button>
                  <div className="flex bg-[#0B0F1A] p-1 rounded-xl border border-[#1A2235]">
                    <button
                      type="button"
                      onClick={() => confirmStoryReset(() => setInputMode('prompt'))}
                      className={cn(
                        "flex items-center px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                        inputMode === 'prompt' ? "bg-[#1A2235] text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      <PenLine className="h-4 w-4 mr-2" /> Prompt
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmStoryReset(() => setInputMode('topic'))}
                      className={cn(
                        "flex items-center px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                        inputMode === 'topic' ? "bg-[#1A2235] text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      <List className="h-4 w-4 mr-2" /> Topic
                    </button>
                  </div>
                </div>
              </div>

              {/* Input Mode Toggle */}
              <div className="flex items-center justify-between sm:hidden space-x-2 mb-4">
                <button
                  type="button"
                  onClick={() => router.push('/media')}
                  className="flex items-center px-3.5 sm:px-4 py-2 rounded-lg text-[13px] sm:text-sm font-bold bg-white/5 text-white hover:bg-white/10 border border-white/10 transition-colors shadow-sm"
                >
                  Media Library
                </button>
                <div className="flex bg-[#0B0F1A] p-1 rounded-xl border border-[#1A2235]">
                  <button
                    type="button"
                    onClick={() => confirmStoryReset(() => setInputMode('prompt'))}
                    className={cn(
                      "flex items-center px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                      inputMode === 'prompt' ? "bg-[#1A2235] text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    <PenLine className="h-4 w-4 mr-2" /> Prompt
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmStoryReset(() => setInputMode('topic'))}
                    className={cn(
                      "flex items-center px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                      inputMode === 'topic' ? "bg-[#1A2235] text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    <List className="h-4 w-4 mr-2" /> Topic
                  </button>
                </div>
              </div>

            <form onSubmit={handleGenerateAndRun} className="space-y-6 relative z-10">

              {/* Prompt vs Topic Content */}
              <AnimatePresence mode="wait">
                {inputMode === 'prompt' ? (
                  <m.div
                    key="prompt-mode"
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-slate-300">Prompt Idea</label>
                      <span className={`text-xs font-semibold ${remainingColor}`}>
                        Uploads left today: {remainingUploads}
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-xl p-4 text-slate-200 placeholder-slate-600 focus:outline-none border-glow-primary transition-colors resize-none shadow-inner"
                      placeholder="Describe your video idea here in detail..."
                      value={prompt}
                        onChange={(e) => {
                          const value = e.target.value;
                          confirmStoryReset(() => setPrompt(value));
                        }}
                    />
                  </m.div>
                ) : (
                  <m.div
                    key="topic-mode"
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                  >
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
                      <select
                        id="content-category"
                        aria-label="Content Category"
                        className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-xl p-3.5 text-slate-200 focus:outline-none border-glow-primary transition-colors"
                        value={selectedTopic}
                          onChange={(e) => {
                            const value = e.target.value;
                            confirmStoryReset(() => setSelectedTopic(value));
                          }}
                      >
                        {TOPIC_CATEGORIES.map(topic => (
                          <option key={topic} value={topic} className="bg-[#111827]">{topic}</option>
                        ))}
                        <option value="Custom" className="bg-[#111827]">Custom Topic...</option>
                      </select>
                    </div>
                    {selectedTopic === 'Custom' && (
                      <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Custom Topic</label>
                        <input
                          type="text"
                          className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-xl p-3.5 text-slate-200 placeholder-slate-600 focus:outline-none border-glow-primary transition-colors shadow-inner"
                          placeholder="E.g. AI advancements in 2024"
                          value={customTopic}
                            onChange={(e) => {
                              const value = e.target.value;
                              confirmStoryReset(() => setCustomTopic(value));
                            }}
                        />
                      </m.div>
                    )}
                  </m.div>
                )}
              </AnimatePresence>

{/* General Settings */}
              <div className="grid grid-cols-2 sm:grid-cols-10 gap-4">
                  <div className="bg-[#0B0F1A] p-3 rounded-xl border border-[#1A2235] col-span-2 sm:col-span-3">
                    <label className="flex items-center text-xs font-medium text-slate-400  uppercase tracking-wider">
                      <Clock className="h-3 w-3 mr-2 text-[#7C5CFF]" /> Duration
                    </label>
                    <div className="text-right text-sm text-[#00D4FF] font-medium mb-1 -mt-1">{duration}s</div>
                    <input id="video-duration" aria-label="Video Duration" type="range" min="10" max="60" className="w-full accent-[#00D4FF]" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                </div>

                  <div className="bg-[#0B0F1A] p-3 rounded-xl border border-[#1A2235] flex flex-col justify-between min-h-[80px] col-span-1 sm:col-span-2">
                    <label className="flex items-center text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                      <FileVideo className="h-3 w-3 mr-2 text-[#7C5CFF]" /> Format
                    </label>
                    <select id="content-type" aria-label="Content Type"
                      className="w-4/5 mx-auto mt-1 bg-transparent text-slate-300 text-sm text-center focus:outline-none cursor-pointer border-b border-[#1A2235] pb-1"
                      value={contentType}
                      onChange={(e) => {
                        if (!canUseFormatSelection) {
                          showUpgradeModal('Format changes');
                          return;
                      }
                      setContentType(e.target.value as ContentType);
                    }}
                  >
                    <option value="clips" className="bg-[#111827]">Clips</option>
                    <option value="images" className="bg-[#111827]">Images</option>
                    <option value="mixed" className="bg-[#111827]">Mixed</option>
                  </select>
                </div>

                  <div className="bg-[#0B0F1A] p-3 rounded-xl border border-[#1A2235] flex flex-col justify-between min-h-[80px] col-span-1 sm:col-span-2">
                    <label className="flex items-center text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                      <ListVideo className="h-3 w-3 mr-2 text-[#7C5CFF]" /> Count
                    </label>
                    <input
                      id="video-count"
                      aria-label="Number of videos to generate"
                      type="number" required min="1"
                      className="w-2/5 mx-auto mt-1 bg-transparent text-slate-300 text-sm text-center focus:outline-none border-b border-[#1A2235] pb-1 focus:border-[#00D4FF] transition-colors"
                      value={videoCount}
                      onChange={(e) => setVideoCount(Number(e.target.value))}
                    />
                  </div>

                  <div className="bg-[#0B0F1A] p-3 rounded-xl border border-[#1A2235] col-span-2 sm:col-span-3">
                    <label className="flex items-center text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">
                      <Youtube className="h-3 w-3 mr-2 text-[#7C5CFF]" /> Channel
                    </label>
                    <select
                      id="channel-select-inline"
                      aria-label="Select YouTube Channel"
                      className="w-full bg-transparent text-slate-300 text-sm focus:outline-none cursor-pointer"
                      value={selectedChannelId}
                      onChange={(e) => {
                        const nextChannelId = e.target.value;
                        switchChannel(nextChannelId);
                      }}
                    >
                      {!user?.isYoutubeConnected && (
                        <option value="" className="bg-[#111827]">Connect YouTube</option>
                      )}
                      {user?.isYoutubeConnected && validYouTubeChannels.length === 0 && (
                        <option value="" className="bg-[#111827]">No channels found</option>
                      )}
                        {user?.isYoutubeConnected && validYouTubeChannels.length > 0 && (
                          validYouTubeChannels.map((channel) => (
                            <option key={channel.channelId} value={channel.channelId} className="bg-[#111827]">
                              {channel.channelName}
                            </option>
                          ))
                        )}
                      </select>
                      {!user?.isYoutubeConnected && (
                        <p className="text-[10px] text-slate-500 mt-1"></p>
                      )}
                      {user?.isYoutubeConnected && validYouTubeChannels.length === 0 && (
                        <p className="text-[10px] text-slate-500 mt-1">
                          {invalidYouTubeChannels.length > 0 ? 'Reconnect expired channel(s) to continue.' : 'No channels linked yet.'}
                        </p>
                      )}
                    <div className="mt-2 sm:hidden">
                      {!user?.isYoutubeConnected ? (
                        <button type="button" onClick={handleConnectYouTube} className="w-full text-xs bg-white/5 hover:bg-white/10 text-white font-semibold py-2 rounded-lg border border-white/10 transition-colors">
                          Connect YouTube
                        </button>
                      ) : (
                        <button type="button" onClick={handleConnectYouTube} className="w-full text-xs bg-white/5 hover:bg-white/10 text-white font-semibold py-2 rounded-lg border border-white/10 transition-colors">
                          Add Channel
                        </button>
                      )}
                    </div>
                  </div>
              </div>


                {/* Call to Actions & Voices */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">


                <div className="p-4 bg-[#0B0F1A] rounded-xl border border-[#1A2235] hover:border-[#7C5CFF]/50 transition-colors">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex items-center cursor-pointer group">
                      <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors mr-3", ctaEnabled ? "bg-[#7C5CFF] border-[#7C5CFF]" : "bg-[#111827] border-[#1A2235]")}>
                        {ctaEnabled && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                      </div>
                      <span className="text-sm text-slate-300 group-hover:text-white">Add Ending CTA</span>
                      <input
                        id="cta-enabled"
                        aria-label="Enable Call to Action"
                        type="checkbox"
                        className="hidden"
                        checked={ctaEnabled}
                        onChange={() => {
                          if (!canUseCta) {
                            showUpgradeModal('Ending CTA');
                            return;
                          }
                          setCtaEnabled(!ctaEnabled);
                        }}
                      />
                    </label>

                    <label className={cn("flex items-center group", !canUseStoryMode && "opacity-70")}>
                      <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors mr-3", effectiveStoryMode ? "bg-[#7C5CFF] border-[#7C5CFF]" : "bg-[#111827] border-[#1A2235]")}>
                        {effectiveStoryMode && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                      </div>
                      <span className="text-sm text-slate-300 group-hover:text-white">Story Mode</span>
                      <input
                        id="story-mode-inline-toggle"
                        aria-label="Enable Story Mode"
                        type="checkbox"
                        className="hidden"
                        checked={effectiveStoryMode}
                        onChange={handleStoryModeToggle}
                      />
                    </label>
                  </div>

                  <AnimatePresence>
                    {effectiveStoryMode && (
                      <m.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-4 pt-4 border-t border-[#1A2235] overflow-hidden"
                      >
                        <label className="flex items-center justify-between rounded-lg border border-[#1A2235] bg-[#0B0F1A] px-3 py-2.5 cursor-pointer group">
                          <div className="flex items-center">
                            <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors mr-3", recapEnabled ? "bg-[#7C5CFF] border-[#7C5CFF]" : "bg-[#111827] border-[#1A2235] group-hover:border-[#7C5CFF]", currentPart === 1 && "opacity-50 cursor-not-allowed")}>
                              {recapEnabled && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                            </div>
                            <span className={cn("text-sm transition-colors", currentPart === 1 ? "text-slate-500" : "text-slate-300 group-hover:text-white")}>
                              Add Recap of Previous Parts
                            </span>
                          </div>
                          <span className={cn("text-[11px]", currentPart === 1 ? "text-slate-500" : "text-slate-600")}>
                            {currentPart === 1 ? 'Available from Part 2' : 'Optional'}
                          </span>
                          <input
                            id="recap-enabled-inline-toggle"
                            aria-label="Enable Story Recap"
                            type="checkbox"
                            className="hidden"
                            checked={recapEnabled}
                            onChange={() => setRecapEnabled(!recapEnabled)}
                            disabled={currentPart === 1}
                          />
                        </label>
                      </m.div>
                    )}
                  </AnimatePresence>

                  <div className="mt-4 pt-4 border-t border-[#1A2235]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Schedule this video</span>
                      <label className={cn("relative inline-flex items-center", !canUseScheduling ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                        <input id="schedule-enabled-toggle" aria-label="Toggle Schedule Enabled"
                          type="checkbox"
                          className="sr-only peer"
                          checked={scheduleEnabled}
                          onChange={(e) => {
                            if (!canUseScheduling) { showUpgradeModal('Scheduling'); return; }
                            const nextChecked = e.target.checked;
                            setScheduleEnabled(nextChecked);
                            if (nextChecked) {
                              setAutoUploadEnabled(false);
                            }
                          }}
                        />
                        <div className="w-11 h-6 bg-[#1A2235] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00D4FF]"></div>
                      </label>
                    </div>

                    <AnimatePresence>
                      {scheduleEnabled && (
                        <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="mt-3">
                            <label className="block text-xs text-slate-400 mb-1">Publish Date & Time</label>
                            <div className="relative">
                              <input
                                id="schedule-datetime"
                                aria-label="Schedule Date and Time"
                                ref={scheduleInputRef}
                                type="datetime-local"
                                value={scheduleDatetime}
                                onChange={(e) => setScheduleDatetime(e.target.value)}
                                className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-lg p-2 text-slate-200 focus:outline-none focus:border-[#00D4FF] transition-colors pr-10"
                              />
                              <button
                                type="button"
                                aria-label="Open calendar"
                                onClick={() => {
                                  const el = scheduleInputRef.current;
                                  if (!el) return;
                                  const pickerEl = el as DateTimePickerInput;
                                  if (typeof pickerEl.showPicker === 'function') {
                                    pickerEl.showPicker();
                                  } else {
                                    el.focus();
                                  }
                                }}
                                className="absolute right-1 top-1/2 -translate-y-1/2 text-white w-9 h-9 flex items-center justify-center rounded-md hover:bg-white/10"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                  <line x1="16" y1="2" x2="16" y2="6" />
                                  <line x1="8" y1="2" x2="8" y2="6" />
                                  <line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                              </button>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">The video will be generated and published at this time.</p>
                          </div>
                        </m.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="mt-4 pt-4 border-t border-[#1A2235]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Auto Upload Schedule</span>
                      <label className={cn("relative inline-flex items-center", !canUseScheduling ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                        <input id="auto-upload-enabled-toggle" aria-label="Toggle Auto Upload Enabled"
                          type="checkbox"
                          className="sr-only peer"
                          checked={autoUploadEnabled}
                          onChange={(e) => {
                            if (!canUseScheduling) { showUpgradeModal('Auto-upload scheduling'); return; }
                            const nextChecked = e.target.checked;
                            setAutoUploadEnabled(nextChecked);
                            if (nextChecked) {
                              setScheduleEnabled(false);
                            }
                          }}
                        />
                        <div className="w-11 h-6 bg-[#1A2235] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00D4FF]"></div>
                      </label>
                    </div>

                    <AnimatePresence>
                      {autoUploadEnabled && (
                        <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Interval (hours)</label>
                              <input id="auto-upload-interval-hours" aria-label="Auto Upload Interval Hours"
                                type="number"
                                min="1"
                                max="24"
                                className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-lg p-2 text-slate-200 focus:outline-none focus:border-[#00D4FF] transition-colors"
                                value={autoUploadIntervalHours}
                                onChange={(e) => setAutoUploadIntervalHours(Number(e.target.value))}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Videos per interval</label>
                              <input id="auto-upload-videos-per-interval" aria-label="Auto Upload Videos Per Interval"
                                type="number"
                                min="1"
                                max="10"
                                className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-lg p-2 text-slate-200 focus:outline-none focus:border-[#00D4FF] transition-colors"
                                value={autoUploadVideosPerInterval}
                                onChange={(e) => setAutoUploadVideosPerInterval(Number(e.target.value))}
                              />
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 mt-2">Each channel runs its own schedule. First upload starts after the selected interval.</p>
                        </m.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                  {/* Voice Selection */}
                  <div className="bg-[#0B0F1A] p-4 rounded-xl border border-[#1A2235] flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <label className="flex items-center text-xs font-medium text-slate-400 uppercase tracking-wider">
                        <Mic className="h-3 w-3 mr-2 text-[#7C5CFF]" /> Voice Selection
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer group">
                      <div className={cn("w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors", randomVoice ? "bg-[#00D4FF] border-[#00D4FF]" : "bg-[#111827] border-[#1A2235]")}>
                        {randomVoice && <div className="w-1.5 h-1.5 bg-[#0B0F1A] rounded-sm" />}
                      </div>
                      <span className="text-xs text-slate-400 group-hover:text-white">Random</span>
                      <input
                        id="random-voice"
                        aria-label="Enable Random Voice"
                        type="checkbox"
                        className="hidden"
                        checked={randomVoice}
                        onChange={(e) => {
                          if (!canUseVoiceSelection) {
                            showUpgradeModal('Voice selection');
                            return;
                          }
                          setRandomVoice(e.target.checked);
                          if (e.target.checked) setSelectedVoices([]);
                        }}
                      />
                    </label>
                  </div>

                    <div className={cn("space-y-2 overflow-y-auto pr-2 transition-all", (scheduleEnabled || autoUploadEnabled) ? "max-h-[260px]" : "max-h-[120px]")}>
                      {AVAILABLE_VOICES.map(voice => (
                        <div key={voice.id} onClick={() => handleVoiceToggle(voice.id)} className={cn("flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors border", selectedVoices.includes(voice.id) && !randomVoice ? "bg-[#1A2235] border-[#7C5CFF]/50 shadow-[0_0_10px_rgba(124,92,255,0.2)]" : "bg-[#111827] border-transparent hover:bg-[#1A2235]/60")}>
                          <span className={cn("text-sm", selectedVoices.includes(voice.id) && !randomVoice ? "text-white" : "text-slate-400")}>{voice.name}</span>
                          <button aria-label={`Play preview for voice ${voice.name}`} type="button" onClick={(e) => playVoicePreview(e, voice.name)} className="p-1.5 rounded bg-[#1A2235] hover:bg-[#7C5CFF] text-slate-400 hover:text-white transition-colors">
                            <Volume2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Subtitle Styling */}
                  <div className="col-span-1 sm:col-span-2 space-y-4">
                    <div className="p-4 bg-gradient-to-r from-[#00D4FF]/10 to-[#7C5CFF]/10 rounded-xl border border-[#00D4FF]/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <Sparkles className="h-5 w-5 text-[#00D4FF] mr-3" />
                          <div>
                            <p className="text-sm font-bold text-white">Subtitle Styling</p>
                            <p className="text-xs text-slate-400">Customize font and subtitle color.</p>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            id="template-config-toggle"
                            aria-label="Toggle Subtitle Styling"
                            type="checkbox"
                            className="sr-only peer"
                            checked={templateConfigOpen}
                            onChange={(e) => {
                              if (!canUseTemplateCustomization) { showUpgradeModal('Subtitle Styling'); return; }
                              setTemplateConfigOpen(e.target.checked);
                            }}
                          />
                          <div className="w-11 h-6 bg-[#1A2235] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00D4FF]"></div>
                        </label>
                      </div>

                      <AnimatePresence>
                        {templateConfigOpen && (
                          <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="mt-4 pt-4 border-t border-[#00D4FF]/20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                              <div>
                                <label className="text-xs text-slate-400 mb-1 block">Font Style</label>
                                <select
                                  id="template-font"
                                  aria-label="Template Font"
                                  value={templateFont}
                                  onChange={async (e) => {
                                    if (!canUseTemplateCustomization) { showUpgradeModal('Subtitle Styling'); return; }
                                    const value = e.target.value;
                                    setTemplateFont(value);
                                    try { await userService.updateSettings({ templateFont: value }); } catch {}
                                  }}
                                  className="w-full bg-[#0B0F1A] text-slate-300 text-sm border border-[#1A2235] rounded-lg p-2 focus:outline-none focus:border-[#00D4FF]"
                                >
                                  <option value="Arial">Arial</option>
                                  <option value="Anton">Anton</option>
                                  <option value="Montserrat">Montserrat</option>
                                  <option value="Bebas Neue">Bebas Neue</option>
                                </select>
                              </div>

                              <div>
                                <label className="text-xs text-slate-400 mb-1 block">Subtitle Color</label>
                                <input
                                  id="template-color"
                                  aria-label="Template Color"
                                  type="color"
                                  value={templateColor}
                                  onChange={async (e) => {
                                    if (!canUseTemplateCustomization) { showUpgradeModal('Subtitle Styling'); return; }
                                    const value = e.target.value;
                                    setTemplateColor(value);
                                    try { await userService.updateSettings({ templateColor: value }); } catch {}
                                  }}
                                  className="w-full h-9 bg-[#0B0F1A] border border-[#1A2235] rounded-lg p-1 cursor-pointer"
                                />
                              </div>

                              <div className="sm:col-span-2 lg:col-span-1">
                                <label className="text-xs text-slate-400 mb-1 block">Max Words Per Caption</label>
                                <input
                                  id="template-max-words"
                                  aria-label="Max Words Per Caption"
                                  type="number"
                                  min="1"
                                  max="8"
                                  value={maxWordsPerCaption}
                                  onChange={(e) => {
                                    if (!canUseTemplateCustomization) { showUpgradeModal('Subtitle Styling'); return; }
                                    const nextValue = Number(e.target.value);
                                    const boundedValue = Math.min(8, Math.max(1, Number.isFinite(nextValue) ? nextValue : 3));
                                    setMaxWordsPerCaption(boundedValue);
                                  }}
                                  className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-lg p-2 text-slate-200 focus:outline-none focus:border-[#00D4FF] transition-colors"
                                />
                                <p className="text-[11px] text-slate-500 mt-1">Recommended range: 2-5 words per caption.</p>
                              </div>

                              <div>
                                <label className="text-xs text-slate-400 mb-1 block">Caption Position</label>
                                <select
                                  id="template-caption-position"
                                  aria-label="Caption Position"
                                  value={captionPosition}
                                  onChange={(e) => {
                                    if (!canUseTemplateCustomization) { showUpgradeModal('Subtitle Styling'); return; }
                                    setCaptionPosition(e.target.value as CaptionPosition);
                                  }}
                                  className="w-full bg-[#0B0F1A] text-slate-300 text-sm border border-[#1A2235] rounded-lg p-2 focus:outline-none focus:border-[#00D4FF]"
                                >
                                  <option value="top">Top</option>
                                  <option value="middle">Middle</option>
                                  <option value="bottom">Bottom</option>
                                </select>
                              </div>

                              <div>
                                <label className="text-xs text-slate-400 mb-1 block">Caption Animation</label>
                                <select
                                  id="template-caption-animation"
                                  aria-label="Caption Animation"
                                  value={captionAnimation}
                                  onChange={(e) => {
                                    if (!canUseTemplateCustomization) { showUpgradeModal('Subtitle Styling'); return; }
                                    setCaptionAnimation(e.target.value as CaptionAnimation);
                                  }}
                                  className="w-full bg-[#0B0F1A] text-slate-300 text-sm border border-[#1A2235] rounded-lg p-2 focus:outline-none focus:border-[#00D4FF]"
                                >
                                  <option value="fade">Fade In/Out</option>
                                  <option value="slide_left">Slide From Left</option>
                                  <option value="slide_right">Slide From Right</option>
                                  <option value="pop">Pop In</option>
                                  <option value="none">No Animation</option>
                                </select>
                              </div>
                            </div>
                          </m.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                </div>

                {/* Custom Media Toggle */}
                <div className="p-4 bg-gradient-to-r from-[#FF4FD8]/10 to-[#7C5CFF]/10 rounded-xl border border-[#FF4FD8]/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <FileVideo className="h-5 w-5 text-[#FF4FD8] mr-3" />
                        <div>
                          <p className="text-sm font-bold text-white">Use Custom Media</p>
                          <p className="text-xs text-slate-400">Inject your uploaded assets into the video generation.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Link
                          href="/media"
                          className="text-xs bg-white/5 hover:bg-white/10 text-white font-semibold px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
                        >
                          Edit Media
                        </Link>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            id="use-custom-media-toggle"
                            aria-label="Toggle Custom Media"
                            type="checkbox"
                            className="sr-only peer"
                            checked={useCustomMedia}
                            onChange={(e) => {
                              if (!canUseCustomMedia) { showUpgradeModal('Custom media'); return; }
                              setUseCustomMedia(e.target.checked);
                            }}
                          />
                          <div className="w-11 h-6 bg-[#1A2235] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FF4FD8]"></div>
                        </label>
                      </div>
                    </div>

                    <AnimatePresence>
                      {useCustomMedia && (
                        <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="mt-4 pt-4 border-t border-[#FF4FD8]/20 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-[#0B0F1A] rounded-lg p-3 border border-[#1A2235]">
                              <span className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Sequence Builder</span>
                              <p className="text-sm text-white font-medium">{sequenceVideoCount} Videos, {sequenceImageCount} Images in sequence.</p>
                              <p className="text-xs text-slate-400 mt-1">Total duration: <span className="text-white font-semibold">{sequenceTotalDuration}s</span></p>
                            </div>
                            <div className="bg-[#0B0F1A] rounded-lg p-3 border border-[#1A2235]">
                              <span className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Custom Thumbnail</span>
                              <select
                                id="thumbnail-select"
                                aria-label="Select Thumbnail"
                                value={selectedThumbnailId}
                                onChange={(e) => setSelectedThumbnailId(e.target.value)}
                                className="w-full bg-transparent text-sm text-white focus:outline-none cursor-pointer"
                              >
                                <option value="" className="bg-[#111827]">Let AI Generate Thumbnail</option>
                                {mediaList.filter(m => m.type === 'thumbnail').map(thumb => (
                                  <option key={thumb._id} value={thumb._id} className="bg-[#111827]">{thumb.originalName}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </m.div>
                        )}
                      </AnimatePresence>
                  </div>

                <m.button
                  id="generate-pipeline-btn"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  type="submit"
                  disabled={generating || !user?.isYoutubeConnected}
                  className="w-full py-4 px-4 bg-gradient-primary text-white font-extrabold rounded-full shadow-glow-primary hover:shadow-glow-primary-hover transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center text-lg tracking-wide border border-white/20"
                >
                {generating ? (
                  <RefreshCw className="h-6 w-6 animate-spin mr-3" />
                ) : (
                  <Play className="h-6 w-6 mr-3 fill-white" />
                )}
                {generating ? 'Processing Pipeline...' : 'Generate & Run Pipeline'}
              </m.button>
            </form>
          </m.div>
        </div>

        {/* Right Column: Status & Connections */}
        <div className="space-y-6">
          <m.div whileHover={{ scale: 1.01 }} className="bg-[#111827] border border-[#1A2235] rounded-2xl p-3 sm:p-6 shadow-xl relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <Youtube className="h-24 w-24" />
             </div>
             <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Integrations</h3>

             <div className="flex flex-col space-y-4 relative z-10">
                <div className="flex flex-col p-4 bg-[#0B0F1A] rounded-xl border border-[#1A2235]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <div className="relative mr-3">
                        <Youtube className={`h-6 w-6 ${user?.isYoutubeConnected ? 'text-[#FF4FD8]' : 'text-slate-600'}`} />
                        <div className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#0B0F1A] ${user?.isYoutubeConnected ? 'bg-[#00D4FF] shadow-[0_0_8px_rgba(0,212,255,0.8)]' : 'bg-red-500'}`}></div>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">YouTube Channel</p>
                        <p className="text-xs text-slate-500">{user?.isYoutubeConnected ? 'Authorized' : 'Disconnected'}</p>
                      </div>
                    </div>
                    {!user?.isYoutubeConnected ? (
                      <button onClick={handleConnectYouTube} className="text-xs bg-white/5 hover:bg-white/10 text-white font-semibold px-3 py-1.5 rounded-lg border border-white/10 transition-colors">
                        Connect
                      </button>
                    ) : (
                      <button onClick={handleConnectYouTube} className="text-xs bg-white/5 hover:bg-white/10 text-white font-semibold px-3 py-1.5 rounded-lg border border-white/10 transition-colors">
                        Add Channel
                      </button>
                    )}
                  </div>

                  {user?.isYoutubeConnected && validYouTubeChannels.length > 0 && (
                    <div className="mt-2">
                      <select
                        id="channel-select"
                        aria-label="Select Channel"
                        value={selectedChannelId}
                        onChange={(e) => switchChannel(e.target.value)}
                        className="w-full bg-[#111827] text-slate-300 text-sm border border-[#1A2235] rounded-lg p-2 focus:outline-none focus:border-[#00D4FF]"
                      >
                        {validYouTubeChannels.map((channel) => (
                          <option key={channel.channelId} value={channel.channelId}>
                            {channel.channelName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {user?.isYoutubeConnected && reconnectChannelsToShow.length > 0 && (
                    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                      <p className="text-xs font-semibold text-red-300 mb-2">Reconnect Required</p>
                      <div className="space-y-2">
                        {reconnectChannelsToShow.map((channel) => (
                          <div key={channel.channelId} className="flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-300 truncate">{channel.channelName}</span>
                            <button
                              type="button"
                              onClick={() => handleReconnectChannel(channel.channelId)}
                              className="text-[11px] bg-red-500/20 hover:bg-red-500/30 text-red-200 font-semibold px-2.5 py-1 rounded border border-red-500/30 transition-colors"
                            >
                              Reconnect
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {user?.plan === 'free' && (
                  <div className="p-4 bg-[#1A2235]/50 rounded-xl border border-[#7C5CFF]/30 group">
                    <p className="text-sm font-medium text-slate-300 mb-3 group-hover:text-white transition-colors">Upgrade to Pro to unlock unlimited processing and priority queues.</p>
                    <button onClick={handleUpgrade} className="w-full text-xs bg-gradient-primary text-white font-bold py-2.5 rounded-lg transition-transform hover:scale-[1.02] shadow-glow-primary">
                      Upgrade to Pro
                    </button>
                  </div>
                )}
             </div>
          </m.div>
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
        isLoading={false}
      />

    </DashboardLayout>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center"><RefreshCw className="h-8 w-8 text-[#7C5CFF] animate-spin" /></div>}>
      <Dashboard />
    </Suspense>
  );
}




