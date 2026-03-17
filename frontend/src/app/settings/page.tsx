'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Youtube, Mail, BellRing, Trash2, ShieldAlert, CheckCircle2, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService';
import { youtubeService } from '../../services/youtubeService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { usePersistentSettings } from '../../hooks/usePersistentSettings';

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const [, setStoryPart] = usePersistentSettings<number>('clipforge_storyPart', 1);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData = await authService.getMe();
        setUser(userData.data);
      } catch (err) {
        authService.logout();
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleConnectYouTube = () => {
    window.location.href = youtubeService.getAuthUrl();
  };

  const handleDisconnectYouTube = async () => {
    setDisconnecting(true);
    setMessage(null);
    try {
      await youtubeService.disconnect();
      setUser({ ...user, isYoutubeConnected: false });
      setMessage({ text: 'YouTube account disconnected successfully', type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to disconnect YouTube', type: 'error' });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleResetMemory = () => {
    setStoryPart(1);
    setMessage({ text: 'Story memory has been reset to Part 1', type: 'success' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-green-500 animate-spin" />
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
            className={`p-4 rounded-xl border flex items-start space-x-3 mb-6 ${
              message.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
              message.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' :
              'bg-green-500/10 border-green-500/20 text-green-400'
            }`}
          >
            {message.type === 'success' ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" /> : <ShieldAlert className="h-5 w-5 flex-shrink-0 mt-0.5" />}
            <span className="text-sm font-medium">{message.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-[#111827] border border-slate-800 rounded-2xl shadow-xl overflow-hidden mb-6">
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-slate-500/10 rounded-lg flex items-center justify-center mr-4 border border-slate-500/20">
              <Settings className="h-5 w-5 text-slate-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Account Settings</h2>
          </div>
        </div>

        <div className="p-6 md:p-8 space-y-10">

          {/* YouTube Integrations */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6 flex items-center">
              <Youtube className="h-4 w-4 mr-2" /> Content Integrations
            </h3>
            <div className="flex items-center justify-between p-5 bg-[#0f172a] rounded-xl border border-slate-800">
              <div>
                <p className="text-base font-bold text-white mb-1">YouTube Access</p>
                <p className="text-sm text-slate-500 max-w-xl">
                  {user?.isYoutubeConnected
                    ? "Your account is authorized to upload generated Shorts."
                    : "Connect your YouTube channel to enable automatic video pipeline uploads."}
                </p>
              </div>
              <div className="flex items-center">
                {user?.isYoutubeConnected ? (
                  <button
                    onClick={handleDisconnectYouTube}
                    disabled={disconnecting}
                    className="flex items-center text-sm bg-red-500/10 hover:bg-red-500/20 text-red-500 font-semibold px-4 py-2 rounded-lg border border-red-500/20 transition-colors disabled:opacity-50"
                  >
                    {disconnecting ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={handleConnectYouTube}
                    className="flex items-center text-sm bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
                  >
                    <Youtube className="h-4 w-4 mr-2" />
                    Connect Channel
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Contact / Notifications */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6 flex items-center">
              <BellRing className="h-4 w-4 mr-2" /> Communications
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-5 bg-[#0f172a] rounded-xl border border-slate-800">
                <div>
                  <p className="text-base font-bold text-white mb-1 flex items-center"><Mail className="h-4 w-4 mr-2 text-slate-400" /> Account Email</p>
                  <p className="text-sm text-slate-500">System notifications and billing receipts are sent here.</p>
                </div>
                <div className="text-sm text-slate-300 bg-slate-800 px-4 py-2 rounded-lg font-medium">
                  {user?.email}
                </div>
              </div>
              <div className="flex items-center justify-between p-5 bg-[#0f172a] rounded-xl border border-slate-800 opacity-60 pointer-events-none">
                <div>
                  <p className="text-base font-bold text-white mb-1 flex items-center">Telegram Connect</p>
                  <p className="text-sm text-slate-500">Receive instant pipeline updates via Telegram Bot.</p>
                </div>
                <button className="text-sm bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg transition-colors">
                  Setup Bot
                </button>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div>
            <h3 className="text-sm font-semibold text-red-500 uppercase tracking-wider mb-6 flex items-center">
              Danger Zone
            </h3>
            <div className="flex items-center justify-between p-5 bg-red-500/5 rounded-xl border border-red-500/10">
              <div>
                <p className="text-base font-bold text-white mb-1">Reset Story Memory</p>
                <p className="text-sm text-slate-500">Erase your active multi-part story tracking state back to Part 1.</p>
              </div>
              <button onClick={handleResetMemory} className="text-sm bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg shadow-lg shadow-red-600/20 transition-colors">
                Clear Memory
              </button>
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}
