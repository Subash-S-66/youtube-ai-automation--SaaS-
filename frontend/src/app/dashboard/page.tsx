'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Activity, Youtube, ListVideo, Clock, FileVideo,
  ShieldAlert, Sparkles, RefreshCw, PenLine, List,
  BookOpen, Mic, Volume2
} from 'lucide-react';
import { authService } from '../../services/authService';
import { youtubeService } from '../../services/youtubeService';
import { promptService } from '../../services/promptService';
import { pipelineService } from '../../services/pipelineService';
import { paymentService } from '../../services/paymentService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import AppModal, { AppModalType } from '../../components/ui/AppModal';
import { usePersistentSettings } from '../../hooks/usePersistentSettings';
import { requestNotificationPermission } from '../../lib/notifications';
import { cn } from '../../lib/utils';

const TOPIC_CATEGORIES = ["World News", "Tech", "Science", "Nature", "Story Mode", "Auto"];

const AVAILABLE_VOICES = [
  { id: 'v1', name: 'Adam (Deep/Calm)' },
  { id: 'v2', name: 'Sarah (Energetic)' },
  { id: 'v3', name: 'Marcus (Narrator)' },
  { id: 'v4', name: 'Rachel (News Anchor)' },
];

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Persistent Settings
  const [inputMode, setInputMode] = usePersistentSettings<'topic' | 'prompt'>('clipforge_inputMode', 'prompt');
  const [prompt, setPrompt] = usePersistentSettings<string>('clipforge_prompt', '');
  const [selectedTopic, setSelectedTopic] = usePersistentSettings<string>('clipforge_topic', 'Tech');
  const [customTopic, setCustomTopic] = usePersistentSettings<string>('clipforge_customTopic', '');

  const [duration, setDuration] = usePersistentSettings<number>('clipforge_duration', 60);
  const [contentType, setContentType] = usePersistentSettings<'clips' | 'images' | 'mixed'>('clipforge_contentType', 'mixed');
  const [videoCount, setVideoCount] = usePersistentSettings<number>('clipforge_videoCount', 1);

  // Story Mode State
  const [storyMode, setStoryMode] = usePersistentSettings<boolean>('clipforge_storyMode', false);
  const [currentPart, setCurrentPart] = usePersistentSettings<number>('clipforge_currentPart', 1);
  const [storyId, setStoryId] = usePersistentSettings<string>('clipforge_storyId', '');
  const [storyContext, setStoryContext] = usePersistentSettings<string>('clipforge_storyContext', '');
  const [recapEnabled, setRecapEnabled] = usePersistentSettings<boolean>('clipforge_recapEnabled', false);

  // Settings
  const [ctaEnabled, setCtaEnabled] = usePersistentSettings<boolean>('clipforge_ctaEnabled', false);
  const [selectedVoices, setSelectedVoices] = usePersistentSettings<string[]>('clipforge_voices', ['v1']);
  const [randomVoice, setRandomVoice] = usePersistentSettings<boolean>('clipforge_randomVoice', true);

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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData = await authService.getMe();
        setUser(userData.data);

        if (userData.data?.youtubeChannels && userData.data.youtubeChannels.length > 0) {
            setSelectedChannelId(userData.data.youtubeChannels[0].channelId);
        }

        const jobsData = await pipelineService.getJobs();
        setJobs(jobsData.data);

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
        }

        // Request notification permission once user is loaded
        requestNotificationPermission();
      } catch (err) {
        authService.logout();
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (user) {
        interval = setInterval(async () => {
            try {
                const jobsData = await pipelineService.getJobs();

            // Check for newly completed/failed jobs to notify the user
            const currentJobs = jobsData.data || [];
            const seenJobNotifications = JSON.parse(localStorage.getItem('seenJobNotifications') || '[]');

            for (const job of currentJobs) {
                if ((job.status === 'success' || job.status === 'failed') && !seenJobNotifications.includes(job._id)) {
                    seenJobNotifications.push(job._id);
                    localStorage.setItem('seenJobNotifications', JSON.stringify(seenJobNotifications));

                    if (job.status === 'success') {
                        setModalConfig({
                            isOpen: true,
                            title: 'Job Completed',
                            description: 'Your video generation and upload has completed successfully!',
                            type: 'success',
                            confirmText: 'Awesome',
                            onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
                        });
                    } else if (job.status === 'failed') {
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

            setJobs(currentJobs);
            } catch (err) {
                // Silently ignore polling errors
            }
        }, 5000);
    }
    return () => clearInterval(interval);
  }, [user]);

  const handleConnectYouTube = () => window.location.href = youtubeService.getAuthUrl();
  const handleUpgrade = async () => {
    try {
      const response = await paymentService.createCheckoutSession();
      if (response.success && response.url) {
        window.location.href = response.url;
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to start checkout', type: 'error' });
    }
  };

  const handleVoiceToggle = (vid: string) => {
    if (randomVoice) setRandomVoice(false);
    setSelectedVoices(prev =>
      prev.includes(vid) ? prev.filter(id => id !== vid) : [...prev, vid]
    );
  };

  const playVoicePreview = (e: React.MouseEvent, voiceName: string) => {
    e.stopPropagation();
    // Mock play functionality
    console.log(`Playing sample for ${voiceName}...`);
  };

  const handleGenerateAndRun = async (e: React.FormEvent) => {
    e.preventDefault();
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

    if (inputMode === 'prompt' && !prompt.trim()) {
      setMessage({ text: 'Please enter a prompt idea.', type: 'error' });
      return;
    }

    if (inputMode === 'topic' && selectedTopic === 'Custom' && !customTopic.trim()) {
      setMessage({ text: 'Please enter a custom topic.', type: 'error' });
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
      // 1. Manage Story ID
      let currentStoryId = storyId;
      if (storyMode && currentPart === 1) {
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

      if (storyMode) {
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

      const promptRes = await promptService.generatePrompt(finalPrompt);
      const promptId = promptRes.data.id;

      // Determine final voice(s) selected
      let finalVoices = selectedVoices;
      if (randomVoice || selectedVoices.length === 0) {
        finalVoices = [AVAILABLE_VOICES[Math.floor(Math.random() * AVAILABLE_VOICES.length)].id];
      }

      await executePipeline(promptId, false, promptRes.data?.gemini_prompt, currentStoryId);
    } catch (err: any) {
      console.error(err);
      if (err.response?.data?.warning) {
        setModalConfig({
          isOpen: true,
          title: 'Limit Warning',
          description: err.response.data.warning,
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

  const handleApiError = (err: any) => {
     const errorMsg = err.response?.data?.message || err.message || 'An unknown error occurred.';

     if (errorMsg.includes('youtube_token_expired') || errorMsg.includes('YouTube channel is not connected or token is invalid')) {
         setModalConfig({
             isOpen: true,
             title: 'YouTube Reconnect Required',
             description: 'Your YouTube token has expired or is invalid. Please reconnect your account to continue.',
             type: 'error',
             confirmText: 'Reconnect',
             onConfirm: handleConnectYouTube,
             cancelText: 'Close',
             onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
         });
     } else if (errorMsg.includes('Maximum concurrent jobs reached') || errorMsg.includes('videos running/pending') || errorMsg.includes('Not enough uploads remaining') || errorMsg.includes('exceeds the strict limit')) {
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

  const executePipeline = async (pId: string, acceptedWarning: boolean, newPromptContent?: string, executeStoryId?: string) => {
    try {
      if (acceptedWarning) {
          setGenerating(true);
      }
      let finalVoices = selectedVoices;
      if (randomVoice && AVAILABLE_VOICES.length > 0) {
        finalVoices = [AVAILABLE_VOICES[Math.floor(Math.random() * AVAILABLE_VOICES.length)]!.id];
      }

      const pipelineRes = await pipelineService.runPipeline(pId, {
        targetDuration: duration,
        contentType,
        videoCount,
        channelId: selectedChannelId,
        storyMode,
        storyId: executeStoryId || storyId,
        currentPart,
        recapEnabled,
        ctaEnabled,
        voices: finalVoices
      }, acceptedWarning);

      if (pipelineRes.warning) {
          setMessage({ text: pipelineRes.warning, type: 'warning' });
      } else {
          setMessage({ text: 'Pipeline started successfully!', type: 'success' });
      }

      // If story mode, save context for the next part and increment
      if (storyMode) {
        setStoryContext(prevContext => {
          // ensure we only append the newly generated content, not the prompt with previous context already injected
          const newContext = newPromptContent || (inputMode === 'prompt' ? prompt : `Video about: ${selectedTopic === 'Custom' ? customTopic : selectedTopic}`);
          return prevContext ? `${prevContext}\n\n[Part ${currentPart}]: ${newContext}` : `[Part 1]: ${newContext}`;
        });
        setCurrentPart(prev => prev + 1);
      }

      const jobsData = await pipelineService.getJobs();
      setJobs(jobsData.data);
      setModalConfig(prev => ({ ...prev, isOpen: false }));
      setPendingPromptId(null);
      setPendingPromptContent(null);
    } catch (err: any) {
      console.error(err);
      if (err.response?.data?.warning) {
         setPendingPromptId(pId);
         setPendingPromptContent(newPromptContent || null);
         setModalConfig({
            isOpen: true,
            title: 'Limit Warning',
            description: err.response.data.warning,
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
      if (acceptedWarning) {
          setGenerating(false);
      }
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
      <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-[#7C5CFF] animate-spin" />
      </div>
    );
  }


  return (
    <DashboardLayout user={user}>

      <AnimatePresence>
        {message && (
          <motion.div
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
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Left Column: Form */}
        <div className="xl:col-span-2 space-y-6">

          <motion.div whileHover={{ scale: 1.002 }} className="bg-[#111827] border border-[#1A2235] rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-6 border-b border-[#1A2235] pb-4">
              <div className="flex items-center">
                <div className="h-10 w-10 bg-[#7C5CFF]/10 rounded-xl flex items-center justify-center mr-4 border border-[#7C5CFF]/20 shadow-glow-primary">
                  <Sparkles className="h-5 w-5 text-[#00D4FF]" />
                </div>
                <h2 className="text-xl font-bold text-white tracking-tight">Generation Engine</h2>
              </div>

              {/* Input Mode Toggle */}
              <div className="flex bg-[#0B0F1A] p-1 rounded-xl border border-[#1A2235]">
                <button
                  type="button"
                  onClick={() => setInputMode('prompt')}
                  className={cn(
                    "flex items-center px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                    inputMode === 'prompt' ? "bg-[#1A2235] text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  <PenLine className="h-4 w-4 mr-2" /> Prompt
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('topic')}
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
                  <motion.div
                    key="prompt-mode"
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                  >
                    <label className="block text-sm font-medium text-slate-300 mb-2">Prompt Idea</label>
                    <textarea
                      rows={3}
                      className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-xl p-4 text-slate-200 placeholder-slate-600 focus:outline-none border-glow-primary transition-colors resize-none shadow-inner"
                      placeholder="Describe your video idea here in detail..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="topic-mode"
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                  >
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
                      <select
                        className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-xl p-3.5 text-slate-200 focus:outline-none border-glow-primary transition-colors"
                        value={selectedTopic}
                        onChange={(e) => setSelectedTopic(e.target.value)}
                      >
                        {TOPIC_CATEGORIES.map(topic => (
                          <option key={topic} value={topic} className="bg-[#111827]">{topic}</option>
                        ))}
                        <option value="Custom" className="bg-[#111827]">Custom Topic...</option>
                      </select>
                    </div>
                    {selectedTopic === 'Custom' && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Custom Topic</label>
                        <input
                          type="text"
                          className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-xl p-3.5 text-slate-200 placeholder-slate-600 focus:outline-none border-glow-primary transition-colors shadow-inner"
                          placeholder="E.g. AI advancements in 2024"
                          value={customTopic}
                          onChange={(e) => setCustomTopic(e.target.value)}
                        />
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Story Mode Options */}
              <div className="p-5 bg-gradient-to-r from-[#7C5CFF]/10 to-[#00D4FF]/10 rounded-xl border border-[#7C5CFF]/30">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <BookOpen className="h-5 w-5 text-[#00D4FF] mr-2" />
                    <h3 className="text-sm font-semibold text-white">Story Mode</h3>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={storyMode} onChange={() => setStoryMode(!storyMode)} />
                    <div className="w-11 h-6 bg-[#1A2235] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#7C5CFF]"></div>
                  </label>
                </div>

                <AnimatePresence>
                  {storyMode && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pt-2 border-t border-[#7C5CFF]/20">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">Current Progress: <strong className="text-[#00D4FF] font-mono text-base">Part {currentPart}</strong></span>
                        <button type="button" onClick={() => { setCurrentPart(1); setStoryId(''); setStoryContext(''); }} className="text-xs bg-[#1A2235] hover:bg-[#2a3550] text-slate-300 px-3 py-1.5 rounded-lg transition-colors border border-[#1A2235]">
                          Reset Story
                        </button>
                      </div>
                      <label className="flex items-center space-x-3 cursor-pointer group">
                        <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors", recapEnabled ? "bg-[#7C5CFF] border-[#7C5CFF]" : "bg-[#0B0F1A] border-[#1A2235] group-hover:border-[#7C5CFF]", currentPart === 1 && "opacity-50 cursor-not-allowed")}>
                          {recapEnabled && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                        </div>
                        <span className={cn("text-sm transition-colors", currentPart === 1 ? "text-slate-600" : "text-slate-300 group-hover:text-white")}>
                          Add Recap of Previous Parts (Disabled on Part 1)
                        </span>
                        <input type="checkbox" className="hidden" checked={recapEnabled} onChange={() => setRecapEnabled(!recapEnabled)} disabled={currentPart === 1} />
                      </label>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* General Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-[#0B0F1A] p-4 rounded-xl border border-[#1A2235]">
                  <label className="flex items-center text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">
                    <Clock className="h-3 w-3 mr-2 text-[#7C5CFF]" /> Duration
                  </label>
                  <input type="range" min="10" max="60" className="w-full accent-[#00D4FF]" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                  <div className="text-right text-sm text-[#00D4FF] font-medium mt-1">{duration}s</div>
                </div>

                <div className="bg-[#0B0F1A] p-4 rounded-xl border border-[#1A2235]">
                  <label className="flex items-center text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">
                    <FileVideo className="h-3 w-3 mr-2 text-[#7C5CFF]" /> Format
                  </label>
                  <select
                    className="w-full bg-transparent text-slate-300 text-sm focus:outline-none cursor-pointer"
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as any)}
                  >
                    <option value="clips" className="bg-[#111827]">Clips</option>
                    <option value="images" className="bg-[#111827]">Images</option>
                    <option value="mixed" className="bg-[#111827]">Mixed</option>
                  </select>
                </div>

                <div className="bg-[#0B0F1A] p-4 rounded-xl border border-[#1A2235]">
                  <label className="flex items-center text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">
                    <ListVideo className="h-3 w-3 mr-2 text-[#7C5CFF]" /> Count
                  </label>
                  <input
                    type="number" required min="1"
                    className="w-full bg-transparent text-slate-300 text-sm focus:outline-none border-b border-[#1A2235] pb-1 focus:border-[#00D4FF] transition-colors"
                    value={videoCount}
                    onChange={(e) => setVideoCount(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Call to Actions & Voices */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-center p-4 bg-[#0B0F1A] rounded-xl border border-[#1A2235] cursor-pointer group hover:border-[#7C5CFF]/50 transition-colors">
                  <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors mr-3", ctaEnabled ? "bg-[#7C5CFF] border-[#7C5CFF]" : "bg-[#111827] border-[#1A2235]")}>
                     {ctaEnabled && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                  </div>
                  <span className="text-sm text-slate-300 group-hover:text-white">Add Ending CTA</span>
                  <input type="checkbox" className="hidden" checked={ctaEnabled} onChange={() => setCtaEnabled(!ctaEnabled)} />
                </label>

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
                      <input type="checkbox" className="hidden" checked={randomVoice} onChange={(e) => {
                        setRandomVoice(e.target.checked);
                        if (e.target.checked) setSelectedVoices([]);
                      }} />
                    </label>
                  </div>

                  <div className="space-y-2 max-h-[120px] overflow-y-auto pr-2">
                    {AVAILABLE_VOICES.map(voice => (
                      <div key={voice.id} onClick={() => handleVoiceToggle(voice.id)} className={cn("flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors border", selectedVoices.includes(voice.id) && !randomVoice ? "bg-[#1A2235] border-[#7C5CFF]/50 shadow-[0_0_10px_rgba(124,92,255,0.2)]" : "bg-[#111827] border-transparent hover:bg-[#1A2235]/60")}>
                        <span className={cn("text-sm", selectedVoices.includes(voice.id) && !randomVoice ? "text-white" : "text-slate-400")}>{voice.name}</span>
                        <button type="button" onClick={(e) => playVoicePreview(e, voice.name)} className="p-1.5 rounded bg-[#1A2235] hover:bg-[#7C5CFF] text-slate-400 hover:text-white transition-colors">
                          <Volume2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <motion.button
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
              </motion.button>
            </form>
          </motion.div>
        </div>

        {/* Right Column: Status & Connections */}
        <div className="space-y-6">
          <motion.div whileHover={{ scale: 1.01 }} className="bg-[#111827] border border-[#1A2235] rounded-2xl p-6 shadow-xl relative overflow-hidden">
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

                  {user?.isYoutubeConnected && user?.youtubeChannels && user.youtubeChannels.length > 0 && (
                    <div className="mt-2">
                      <select
                        value={selectedChannelId}
                        onChange={(e) => setSelectedChannelId(e.target.value)}
                        className="w-full bg-[#111827] text-slate-300 text-sm border border-[#1A2235] rounded-lg p-2 focus:outline-none focus:border-[#00D4FF]"
                      >
                        {user.youtubeChannels.map((channel: any) => (
                          <option key={channel.channelId} value={channel.channelId}>
                            {channel.channelName}
                          </option>
                        ))}
                      </select>
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
          </motion.div>
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
        isLoading={generating}
      />

    </DashboardLayout>
  );
}
