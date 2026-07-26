"use client";

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { getApiOrigin } from '../../lib/apiBase';

export default function GlobalBanner() {
  const pathname = usePathname();
  const isLandingPage = pathname === '/' || pathname === '/landing';

  const [banner, setBanner] = useState<{
    message: string;
    isActive: boolean;
    type:
      | 'info-blue'
      | 'info-cyan'
      | 'info-green'
      | 'info-purple'
      | 'warning-amber'
      | 'warning-gold'
      | 'critical-red'
      | 'critical-rose';
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (banner && banner.isActive && !dismissed && !isLandingPage) {
      document.body.classList.add('has-global-banner');
    } else {
      document.body.classList.remove('has-global-banner');
    }

    return () => {
      document.body.classList.remove('has-global-banner');
    };
  }, [banner, dismissed, isLandingPage]);

  useEffect(() => {
    const fetchBanner = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`${getApiOrigin()}/api/banner`);
        const data = await response.json();
        if (data.success && data.data && data.data.isActive) {
          setBanner(data.data);
        } else {
          setBanner(null);
        }
      } catch (error) {
        console.error('Failed to fetch global banner', error);
      }
    };

    fetchBanner();

    // Poll every 60 seconds
    const intervalId = setInterval(fetchBanner, 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setDismissed(false);
  }, [banner?.message, banner?.isActive, banner?.type]);

  const currentStyle = useMemo(() => {
    if (!banner) return 'banner-info-blue';
    const map: Record<string, string> = {
      'info-blue': 'banner-info-blue',
      'info-cyan': 'banner-info-cyan',
      'info-green': 'banner-info-green',
      'info-purple': 'banner-info-purple',
      'warning-amber': 'banner-warning-amber',
      'warning-gold': 'banner-warning-gold',
      'critical-red': 'banner-critical-red',
      'critical-rose': 'banner-critical-rose',
    };
    return map[banner.type] || 'banner-info-blue';
  }, [banner, dismissed]);

  if (!banner || !banner.isActive || dismissed || isLandingPage) return null;

  return (
    <div className={`w-full h-10 font-medium overflow-hidden z-[999] fixed top-0 left-0 flex items-center shadow-md ${currentStyle}`}>
      <div className="relative w-full h-full flex items-center overflow-hidden pl-2 pr-10">
        <div className="banner-marquee whitespace-nowrap flex items-center h-full min-w-full">
          <span className="px-8 inline-block align-middle">{banner.message}</span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/10 transition-colors"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
