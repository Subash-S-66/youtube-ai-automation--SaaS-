'use client';

import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';

export default function InstallPwaButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    // Check if the app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstallable(false);
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      // Update UI notify the user they can install the PWA
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setIsInstallable(false);
    }

    // Clear the deferredPrompt variable, it can only be used once.
    setDeferredPrompt(null);
  };

  if (!isInstallable) return null;

  return (
    <div className="p-4 border-t border-[#1A2235] bg-[#0B0F1A]/80">
      <button
        onClick={handleInstallClick}
        className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-gradient-primary rounded-lg transition-transform hover:scale-[1.02] shadow-glow-primary hover:shadow-glow-primary-hover"
      >
        <Download className="h-4 w-4 mr-2" />
        Install App
      </button>
    </div>
  );
}
