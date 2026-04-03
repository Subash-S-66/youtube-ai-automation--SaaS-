import { WifiOff } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#0B0F1A] flex flex-col items-center justify-center text-center p-6">
      <div className="relative mb-6">
        <WifiOff className="h-20 w-20 text-[#7C5CFF]" />
        <div className="absolute inset-0 bg-[#7C5CFF] blur-xl opacity-30 rounded-full"></div>
      </div>
      <h1 className="text-3xl font-extrabold text-white mb-2">You're Offline</h1>
      <p className="text-slate-400 max-w-md">
        YouTube Automation requires an active internet connection to generate premium video content. Please check your network and try again.
      </p>
    </div>
  );
}
