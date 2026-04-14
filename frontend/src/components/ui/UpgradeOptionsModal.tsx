'use client';

import { cn } from '../../lib/utils';

interface UpgradeOptionsModalProps {
  open: boolean;
  currentPlan: string;
  targetPlan: string;
  remainingDays: number;
  creditDays: number;
  onClose: () => void;
  onBuy: () => void;
  onConvert: () => void;
}


export default function UpgradeOptionsModal({
  open,
  currentPlan,
  targetPlan,
  remainingDays,
  creditDays,
  onClose,
  onBuy,
  onConvert,
}: UpgradeOptionsModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0B0F1A] border border-[#1A2235] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[#1A2235]">
          <h3 className="text-sm font-bold text-white">Upgrade Options</h3>
          <button onClick={onClose} className="text-xs text-slate-300 hover:text-white">Close</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-300">
            You have <span className="text-white font-semibold">{remainingDays.toFixed(1)}</span> days left on
            <span className="text-white font-semibold"> {currentPlan}</span>. Upgrading to
            <span className="text-white font-semibold"> {targetPlan}</span> converts those days to
            <span className="text-white font-semibold"> {creditDays}</span> days.
          </p>

          <div className="space-y-3">
            <button
              onClick={onBuy}
              className={cn(
                "w-full py-2.5 px-4 rounded-xl font-bold text-sm transition-all",
                "bg-gradient-primary text-white shadow-glow-primary hover:shadow-glow-primary-hover"
              )}
            >
              Buy {targetPlan} + add {creditDays} days
            </button>

            <button
              onClick={onConvert}
              disabled={creditDays <= 0}
              className={cn(
                "w-full py-2.5 px-4 rounded-xl font-bold text-sm border border-[#1A2235] transition-colors",
                creditDays <= 0
                  ? "bg-[#111827] text-slate-500 cursor-not-allowed"
                  : "bg-[#111827] text-slate-200 hover:text-white hover:border-[#7C5CFF]/60"
              )}
            >
              Convert remaining days only (no payment)
            </button>
          </div>

          <p className="text-xs text-slate-500">
            The convert option will replace your remaining subscription with the new plan for the converted days only.
          </p>
        </div>
      </div>
    </div>
  );
}
