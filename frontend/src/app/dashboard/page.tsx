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
import { usePersistentSettings } from '../../hooks/usePersistentSettings';
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
  const [storyPart, setStoryPart] = usePersistentSettings<number>('clipforge_storyPart', 1);
  const [addRecap, setAddRecap] = usePersistentSettings<boolean>('clipforge_addRecap', false);

  // Settings
  const [addEndingCta, setAddEndingCta] = usePersistentSettings<boolean>('clipforge_endingCta', false);
  const [selectedVoices, setSelectedVoices] = usePersistentSettings<string[]>('clipforge_voices', ['v1']);
  const [randomVoice, setRandomVoice] = usePersistentSettings<boolean>('clipforge_randomVoice', true);

  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData = await authService.getMe();
        setUser(userData.data);
        const jobsData = await pipelineService.getJobs();
        setJobs(jobsData.data);
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
                setJobs(jobsData.data);
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
      setMessage({ text: 'Please connect YouTube first', type: 'error' });
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

    setGenerating(true);
    setMessage(null);
    try {
      // Construct the final prompt to pass to Gemini
      let finalPrompt = '';
      if (inputMode === 'prompt') {
        finalPrompt = prompt;
      } else {
        const topicString = selectedTopic === 'Custom' ? customTopic : selectedTopic;
        finalPrompt = `Create a viral short-form video about the topic: ${topicString}.`;
      }

      if (storyMode) {
        finalPrompt += ` This is Part ${storyPart} of an ongoing series.`;
        if (addRecap && storyPart > 1) {
          finalPrompt += ` Begin with a brief recap of the previous parts.`;
        }
      }

      if (addEndingCta) {
        finalPrompt += ` Include a strong call-to-action at the end to subscribe and like the video.`;
      }

      const promptRes = await promptService.generatePrompt(finalPrompt);
      const promptId = promptRes.data.id;

      // Determine final voice(s) selected
      let finalVoices = selectedVoices;
      if (randomVoice || selectedVoices.length === 0) {
        finalVoices = [AVAILABLE_VOICES[Math.floor(Math.random() * AVAILABLE_VOICES.length)].id];
      }

      const pipelineRes = await pipelineService.runPipeline(promptId, {
        duration,
        contentType,
        videoCount,
        storyMode,
        storyPart,
        voices: finalVoices
      });

      if (pipelineRes.warning) {
          setMessage({ text: pipelineRes.warning, type: 'warning' });
      } else {
          setMessage({ text: 'Pipeline started successfully!', type: 'success' });
      }

      // If story mode, automatically increment the part for the next run
      if (storyMode) {
        setStoryPart(prev => prev + 1);
      }

      const jobsData = await pipelineService.getJobs();
      setJobs(jobsData.data);
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to generate video', type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const colors: any = {
      pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      running: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      success: 'bg-green-500/10 text-green-500 border-green-500/20',
      failed: 'bg-red-500/10 text-red-500 border-red-500/20',
    };
    return (
      <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${colors[status] || colors.pending}`}>
        {status}
      </span>
    );
  };

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
              'bg-green-500/10 border-green-500/20 text-green-400'
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

          <motion.div whileHover={{ scale: 1.002 }} className="bg-[#111827] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
              <div className="flex items-center">
                <div className="h-10 w-10 bg-green-500/10 rounded-lg flex items-center justify-center mr-4 border border-green-500/20">
                  <Sparkles className="h-5 w-5 text-green-500" />
                </div>
                <h2 className="text-xl font-bold text-white">Generation Engine</h2>
              </div>

              {/* Input Mode Toggle */}
              <div className="flex bg-[#0f172a] p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setInputMode('prompt')}
                  className={cn(
                    "flex items-center px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                    inputMode === 'prompt' ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  <PenLine className="h-4 w-4 mr-2" /> Prompt
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('topic')}
                  className={cn(
                    "flex items-center px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                    inputMode === 'topic' ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
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
                      className="w-full bg-[#0f172a] border border-slate-700 rounded-xl p-4 text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 transition-colors resize-none"
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
                        className="w-full bg-[#0f172a] border border-slate-700 rounded-xl p-3.5 text-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                        value={selectedTopic}
                        onChange={(e) => setSelectedTopic(e.target.value)}
                      >
                        {TOPIC_CATEGORIES.map(topic => (
                          <option key={topic} value={topic} className="bg-slate-800">{topic}</option>
                        ))}
                        <option value="Custom" className="bg-slate-800">Custom Topic...</option>
                      </select>
                    </div>
                    {selectedTopic === 'Custom' && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Custom Topic</label>
                        <input
                          type="text"
                          className="w-full bg-[#0f172a] border border-slate-700 rounded-xl p-3.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 transition-colors"
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
              <div className="p-5 bg-gradient-to-r from-blue-500/5 to-purple-500/5 rounded-xl border border-blue-500/20">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <BookOpen className="h-5 w-5 text-blue-400 mr-2" />
                    <h3 className="text-sm font-semibold text-white">Story Mode</h3>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={storyMode} onChange={() => setStoryMode(!storyMode)} />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>

                <AnimatePresence>
                  {storyMode && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pt-2 border-t border-blue-500/10">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">Current Progress: <strong className="text-blue-400 font-mono text-base">Part {storyPart}</strong></span>
                        <button type="button" onClick={() => setStoryPart(1)} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                          Reset Story
                        </button>
                      </div>
                      <label className="flex items-center space-x-3 cursor-pointer group">
                        <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors", addRecap ? "bg-blue-500 border-blue-500" : "bg-[#0f172a] border-slate-600 group-hover:border-blue-500", storyPart === 1 && "opacity-50 cursor-not-allowed")}>
                          {addRecap && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                        </div>
                        <span className={cn("text-sm transition-colors", storyPart === 1 ? "text-slate-600" : "text-slate-300 group-hover:text-white")}>
                          Add Recap of Previous Parts (Disabled on Part 1)
                        </span>
                        <input type="checkbox" className="hidden" checked={addRecap} onChange={() => setAddRecap(!addRecap)} disabled={storyPart === 1} />
                      </label>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* General Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800">
                  <label className="flex items-center text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">
                    <Clock className="h-3 w-3 mr-2" /> Duration
                  </label>
                  <input type="range" min="10" max="60" className="w-full accent-green-500" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                  <div className="text-right text-sm text-green-400 font-medium mt-1">{duration}s</div>
                </div>

                <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800">
                  <label className="flex items-center text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">
                    <FileVideo className="h-3 w-3 mr-2" /> Format
                  </label>
                  <select
                    className="w-full bg-transparent text-slate-300 text-sm focus:outline-none cursor-pointer"
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as any)}
                  >
                    <option value="clips" className="bg-slate-800">Clips</option>
                    <option value="images" className="bg-slate-800">Images</option>
                    <option value="mixed" className="bg-slate-800">Mixed</option>
                  </select>
                </div>

                <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800">
                  <label className="flex items-center text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">
                    <ListVideo className="h-3 w-3 mr-2" /> Count
                  </label>
                  <input
                    type="number" required min="1"
                    className="w-full bg-transparent text-slate-300 text-sm focus:outline-none border-b border-slate-700 pb-1"
                    value={videoCount}
                    onChange={(e) => setVideoCount(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Call to Actions & Voices */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-center p-4 bg-[#0f172a] rounded-xl border border-slate-800 cursor-pointer group hover:border-green-500/30 transition-colors">
                  <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors mr-3", addEndingCta ? "bg-green-500 border-green-500" : "bg-[#111827] border-slate-600")}>
                     {addEndingCta && <div className="w-2.5 h-2.5 bg-[#111827] rounded-sm" />}
                  </div>
                  <span className="text-sm text-slate-300 group-hover:text-white">Auto-Generate Ending CTA</span>
                  <input type="checkbox" className="hidden" checked={addEndingCta} onChange={() => setAddEndingCta(!addEndingCta)} />
                </label>

                {/* Voice Selection */}
                <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <label className="flex items-center text-xs font-medium text-slate-400 uppercase tracking-wider">
                      <Mic className="h-3 w-3 mr-2" /> Voice Selection
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer group">
                      <div className={cn("w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors", randomVoice ? "bg-green-500 border-green-500" : "bg-[#111827] border-slate-600")}>
                        {randomVoice && <div className="w-1.5 h-1.5 bg-[#111827] rounded-sm" />}
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
                      <div key={voice.id} onClick={() => handleVoiceToggle(voice.id)} className={cn("flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors border", selectedVoices.includes(voice.id) && !randomVoice ? "bg-slate-800/80 border-green-500/30" : "bg-[#111827] border-transparent hover:bg-slate-800/40")}>
                        <span className={cn("text-sm", selectedVoices.includes(voice.id) && !randomVoice ? "text-green-400" : "text-slate-400")}>{voice.name}</span>
                        <button type="button" onClick={(e) => playVoicePreview(e, voice.name)} className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
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
                className="w-full py-4 px-4 bg-gradient-to-r from-green-500 to-emerald-400 hover:from-green-400 hover:to-emerald-300 text-[#0f172a] font-extrabold rounded-xl shadow-[0_0_30px_rgba(34,197,94,0.2)] hover:shadow-[0_0_30px_rgba(34,197,94,0.4)] transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center text-lg tracking-wide"
              >
                {generating ? (
                  <RefreshCw className="h-6 w-6 animate-spin mr-3" />
                ) : (
                  <Play className="h-6 w-6 mr-3 fill-current" />
                )}
                {generating ? 'Processing Pipeline...' : 'Generate & Run Pipeline'}
              </motion.button>
            </form>
          </motion.div>
        </div>

        {/* Right Column: Status & Connections */}
        <div className="space-y-6">
          <motion.div whileHover={{ scale: 1.01 }} className="bg-[#111827] border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <Youtube className="h-24 w-24" />
             </div>
             <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Integrations</h3>

             <div className="flex flex-col space-y-4 relative z-10">
                <div className="flex items-center justify-between p-4 bg-[#0f172a] rounded-xl border border-slate-800">
                  <div className="flex items-center">
                    <div className="relative mr-3">
                      <Youtube className={`h-6 w-6 ${user?.isYoutubeConnected ? 'text-red-500' : 'text-slate-600'}`} />
                      <div className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#0f172a] ${user?.isYoutubeConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">YouTube</p>
                      <p className="text-xs text-slate-500">{user?.isYoutubeConnected ? 'Authorized' : 'Disconnected'}</p>
                    </div>
                  </div>
                  {!user?.isYoutubeConnected && (
                    <button onClick={handleConnectYouTube} className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-500 font-semibold px-3 py-1.5 rounded-lg border border-red-500/20 transition-colors">
                      Connect
                    </button>
                  )}
                </div>

                {user?.plan === 'free' && (
                  <div className="p-4 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-xl border border-indigo-500/20 group">
                    <p className="text-sm font-medium text-indigo-300 mb-3 group-hover:text-indigo-200 transition-colors">Upgrade to Pro to unlock unlimited processing and priority queues.</p>
                    <button onClick={handleUpgrade} className="w-full text-xs bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-2.5 rounded-lg transition-colors shadow-lg shadow-indigo-500/20">
                      Upgrade to Pro
                    </button>
                  </div>
                )}
             </div>
          </motion.div>
        </div>
      </div>
    </DashboardLayout>
  );
}
