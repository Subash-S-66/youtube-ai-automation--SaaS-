import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, CheckCircle2, AlertCircle, Info, RefreshCw } from 'lucide-react';

export type AppModalType = 'warning' | 'error' | 'success' | 'info';

interface AppModalProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  type?: AppModalType;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  isLoading?: boolean;
}

export default function AppModal({
  isOpen,
  title,
  description,
  type = 'info',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isLoading = false,
}: AppModalProps) {
  if (!isOpen) return null;

  const typeConfig = {
    warning: {
      icon: <ShieldAlert className="h-5 w-5 text-yellow-500" />,
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/30',
      iconBorder: 'border-yellow-500/20',
      btnBg: 'bg-yellow-600 hover:bg-yellow-500',
      btnShadow: 'shadow-yellow-500/20',
    },
    error: {
      icon: <AlertCircle className="h-5 w-5 text-red-500" />,
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      iconBorder: 'border-red-500/20',
      btnBg: 'bg-red-600 hover:bg-red-500',
      btnShadow: 'shadow-red-500/20',
    },
    success: {
      icon: <CheckCircle2 className="h-5 w-5 text-[#00D4FF]" />,
      bg: 'bg-[#00D4FF]/10',
      border: 'border-[#00D4FF]/30',
      iconBorder: 'border-[#00D4FF]/20',
      btnBg: 'bg-[#00D4FF] hover:bg-[#00b8e6]',
      btnShadow: 'shadow-[#00D4FF]/20',
    },
    info: {
      icon: <Info className="h-5 w-5 text-[#7C5CFF]" />,
      bg: 'bg-[#7C5CFF]/10',
      border: 'border-[#7C5CFF]/30',
      iconBorder: 'border-[#7C5CFF]/20',
      btnBg: 'bg-gradient-primary',
      btnShadow: 'shadow-glow-primary',
    },
  };

  const config = typeConfig[type];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`bg-[#111827] border ${config.border} rounded-2xl shadow-2xl max-w-md w-full overflow-hidden`}
        >
          <div className="p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className={`w-10 h-10 rounded-full ${config.bg} flex items-center justify-center border ${config.iconBorder}`}>
                {config.icon}
              </div>
              <h3 className="text-lg font-bold text-white tracking-tight">{title}</h3>
            </div>
            <div className="text-slate-300 text-sm mb-6 leading-relaxed">
              {description}
            </div>
            <div className="flex items-center justify-end space-x-3">
              {onCancel && (
                <button
                  onClick={onCancel}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {cancelText}
                </button>
              )}
              {onConfirm && (
                <button
                  onClick={onConfirm}
                  disabled={isLoading}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold text-white ${config.btnBg} shadow-lg ${config.btnShadow} transition-all flex items-center disabled:opacity-50`}
                >
                  {isLoading ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
                  {confirmText}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
