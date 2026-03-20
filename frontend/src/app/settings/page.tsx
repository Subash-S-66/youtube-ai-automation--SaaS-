'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Youtube, Mail, BellRing, Trash2, ShieldAlert, CheckCircle2, RefreshCw, User, Info, Save, Copy } from 'lucide-react';
import { authService } from '../../services/authService';
import { youtubeService } from '../../services/youtubeService';
import { userService } from '../../services/userService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import AppModal, { AppModalType } from '../../components/ui/AppModal';
import { usePersistentSettings } from '../../hooks/usePersistentSettings';
import { cn } from '../../lib/utils';

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const [, setStoryPart] = usePersistentSettings<number>('clipforge_storyPart', 1);

  // Form State
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [telegramNotifs, setTelegramNotifs] = useState(true);
  const [pushNotifs, setPushNotifs] = useState(true);
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData = await authService.getMe();
        const me = userData.data;
        setUser(me);
        setEmailNotifs(me.user?.emailNotificationsEnabled ?? true);
        setTelegramNotifs(me.user?.telegramNotificationsEnabled ?? true);
        setPushNotifs(me.user?.pushNotificationsEnabled ?? true);
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
      setUser({ ...user, user: { ...user.user, isYoutubeConnected: false } });
      setMessage({ text: 'YouTube account disconnected successfully', type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to disconnect YouTube', type: 'error' });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleResetMemory = () => {
    setModalConfig({
        isOpen: true,
        title: 'Reset Story Memory',
        description: 'Are you sure you want to completely erase your Story memory? You will start over at Part 1 on your next generation. This cannot be undone.',
        type: 'warning',
        confirmText: 'Erase Memory',
        onConfirm: () => {
            setStoryPart(1);
            setMessage({ text: 'Story memory has been reset to Part 1', type: 'success' });
            setModalConfig(prev => ({ ...prev, isOpen: false }));
            setTimeout(() => setMessage(null), 3000);
        },
        cancelText: 'Cancel',
        onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
    });
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setMessage(null);
    try {
      await userService.updateSettings({
        emailNotificationsEnabled: emailNotifs,
        telegramNotificationsEnabled: telegramNotifs,
        pushNotificationsEnabled: pushNotifs
      });
      setMessage({ text: 'Settings saved successfully', type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to save settings', type: 'error' });
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-[#7C5CFF] animate-spin" />
      </div>
    );
  }

  return (
    <DashboardLayout user={user?.user}>

      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`p-4 rounded-xl border flex items-start space-x-3 mb-6 ${
              message.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
              message.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' :
              'bg-[#00D4FF]/10 border-[#00D4FF]/20 text-[#00D4FF]'
            }`}
          >
            {message.type === 'success' ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" /> : <ShieldAlert className="h-5 w-5 flex-shrink-0 mt-0.5" />}
            <span className="text-sm font-medium">{message.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden mb-6 relative">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-primary opacity-50"></div>
        <div className="px-6 py-5 border-b border-[#1A2235] flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-[#7C5CFF]/10 rounded-xl flex items-center justify-center mr-4 border border-[#7C5CFF]/20 shadow-glow-primary">
              <Settings className="h-5 w-5 text-[#7C5CFF]" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Account Settings</h2>
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="flex items-center text-sm bg-gradient-primary text-white font-bold px-4 py-2 rounded-lg transition-transform hover:scale-[1.02] shadow-glow-primary disabled:opacity-50"
          >
            {savingSettings ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Settings
          </button>
        </div>

        <div className="p-6 md:p-8 space-y-10">

          {/* User Info Section */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6 flex items-center">
              <User className="h-4 w-4 mr-2" /> Account Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-5 bg-[#0B0F1A] rounded-xl border border-[#1A2235]">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Current Plan</p>
                <p className="text-lg font-bold text-white capitalize">{user?.plan}</p>
              </div>
              <div className="p-5 bg-[#0B0F1A] rounded-xl border border-[#1A2235]">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Subscription Expiry</p>
                <p className="text-lg font-bold text-white">
                  {user?.user?.subscriptionExpiresAt ? new Date(user.user.subscriptionExpiresAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
              <div className="p-5 bg-[#0B0F1A] rounded-xl border border-[#1A2235]">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Upload Limits</p>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-bold text-[#00D4FF]">{user?.remainingUploads} <span className="text-sm text-slate-400 font-normal">/ {user?.uploadLimit}</span></span>
                  <span className="text-xs text-yellow-400 font-medium">{user?.uploadsOnHold} on hold</span>
                </div>
              </div>
            </div>
          </div>

          {/* YouTube Integrations */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6 flex items-center">
              <Youtube className="h-4 w-4 mr-2" /> Content Integrations
            </h3>
            <div className="flex items-center justify-between p-5 bg-[#0B0F1A] rounded-xl border border-[#1A2235]">
              <div>
                <p className="text-base font-bold text-white mb-1">YouTube Access</p>
                <p className="text-sm text-slate-500 max-w-xl">
                  {user?.user?.isYoutubeConnected
                    ? "Your account is authorized to upload generated Shorts."
                    : "Connect your YouTube channel to enable automatic video pipeline uploads."}
                </p>
              </div>
              <div className="flex items-center">
                {user?.user?.isYoutubeConnected ? (
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
                    className="flex items-center text-sm bg-[#FF4FD8] hover:bg-[#d93cbd] text-white font-bold px-4 py-2 rounded-lg transition-transform hover:scale-[1.02] shadow-glow-accent"
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
              <BellRing className="h-4 w-4 mr-2" /> Notifications & Communications
            </h3>
            <div className="space-y-4">

              <div className="flex items-center justify-between p-5 bg-[#0B0F1A] rounded-xl border border-[#1A2235]">
                <div className="flex-1 pr-4">
                  <p className="text-base font-bold text-white mb-1">Email Notifications</p>
                  <p className="text-sm text-slate-500">Receive pipeline status updates and alerts via email ({user?.user?.email}).</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={emailNotifs} onChange={(e) => setEmailNotifs(e.target.checked)} />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00D4FF]"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-5 bg-[#0B0F1A] rounded-xl border border-[#1A2235]">
                <div className="flex-1 pr-4">
                  <p className="text-base font-bold text-white mb-1">Telegram Notifications</p>
                  <p className="text-sm text-slate-500">Receive instant pipeline updates via Telegram Bot.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={telegramNotifs} onChange={(e) => setTelegramNotifs(e.target.checked)} />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00D4FF]"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-5 bg-[#0B0F1A] rounded-xl border border-[#1A2235]">
                <div className="flex-1 pr-4">
                  <p className="text-base font-bold text-white mb-1">Push Notifications</p>
                  <p className="text-sm text-slate-500">Receive browser-based web push notifications for critical events.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={pushNotifs} onChange={(e) => setPushNotifs(e.target.checked)} />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00D4FF]"></div>
                </label>
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
