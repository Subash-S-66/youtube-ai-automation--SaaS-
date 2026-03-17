'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Activity, Youtube, ListVideo, Clock, FileVideo, ShieldAlert, Sparkles, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService';
import { youtubeService } from '../../services/youtubeService';
import { promptService } from '../../services/promptService';
import { pipelineService } from '../../services/pipelineService';
import { paymentService } from '../../services/paymentService';
import DashboardLayout from '../../components/layout/DashboardLayout';

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<number>(60);
  const [contentType, setContentType] = useState<'clips' | 'images' | 'mixed'>('mixed');
  const [videoCount, setVideoCount] = useState<number>(1);
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

  const handleGenerateAndRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.isYoutubeConnected) {
      setMessage({ text: 'Please connect YouTube first', type: 'error' });
      return;
    }
    setGenerating(true);
    setMessage(null);
    try {
      const promptRes = await promptService.generatePrompt(prompt);
      const promptId = promptRes.data.id;
      const pipelineRes = await pipelineService.runPipeline(promptId, { duration, contentType, videoCount });

      if (pipelineRes.warning) {
          setMessage({ text: pipelineRes.warning, type: 'warning' });
      } else {
          setMessage({ text: 'Pipeline started successfully!', type: 'success' });
      }
      setPrompt('');
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

      {/* Top Warning/Message Area */}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left Column: Form & Connect */}
        <div className="lg:col-span-2 space-y-6">

          {/* Generation Card */}
          <motion.div whileHover={{ scale: 1.005 }} className="bg-[#111827] border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center mb-6">
              <div className="h-10 w-10 bg-green-500/10 rounded-lg flex items-center justify-center mr-4 border border-green-500/20">
                 <Sparkles className="h-5 w-5 text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-white">Generate New Script</h2>
            </div>

            <form onSubmit={handleGenerateAndRun} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Prompt Idea</label>
                <textarea
                  required
                  rows={4}
                  className="w-full bg-[#0f172a] border border-slate-700 rounded-xl p-4 text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 transition-colors resize-none"
                  placeholder="Describe your video idea here..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>

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

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={generating || !user?.isYoutubeConnected}
                className="w-full py-3.5 px-4 bg-green-500 hover:bg-green-400 text-[#0f172a] font-bold rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.3)] transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center"
              >
                {generating ? (
                  <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <Play className="h-5 w-5 mr-2 fill-current" />
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
                  <div className="p-4 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-xl border border-indigo-500/20">
                    <p className="text-sm font-medium text-indigo-300 mb-3">Upgrade to Pro to unlock unlimited processing and high-priority queues.</p>
                    <button onClick={handleUpgrade} className="w-full text-xs bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-2 rounded-lg transition-colors shadow-lg shadow-indigo-500/20">
                      Upgrade to Pro
                    </button>
                  </div>
                )}
             </div>
          </motion.div>

        </div>
      </div>

      {/* Jobs Table */}
      <div className="mt-6 bg-[#111827] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-800 flex items-center">
          <Activity className="h-5 w-5 text-blue-500 mr-2" />
          <h3 className="text-lg font-bold text-white">Recent Jobs</h3>
        </div>
        <div className="overflow-x-auto">
          {jobs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">No jobs executed yet. Generate a script to see history.</div>
          ) : (
            <table className="min-w-full divide-y divide-slate-800/50">
              <thead className="bg-[#0f172a]/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Job ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 bg-[#111827]">
                {jobs.map((job) => (
                  <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} key={job._id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(job.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono">
                      {job._id}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </DashboardLayout>
  );
}
