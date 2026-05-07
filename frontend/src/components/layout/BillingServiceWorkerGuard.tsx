'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const BILLING_ROUTES = new Set(['/subscription', '/pricing', '/payments']);
const RELOAD_MARKER_KEY = 'billing_sw_cleanup_done_v1';

export default function BillingServiceWorkerGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!BILLING_ROUTES.has(pathname)) return;
    if (!('serviceWorker' in navigator)) return;

    const run = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (!registrations.length) return;

        const hadController = Boolean(navigator.serviceWorker.controller);
        await Promise.all(registrations.map((registration) => registration.unregister()));

        if (hadController && !sessionStorage.getItem(RELOAD_MARKER_KEY)) {
          sessionStorage.setItem(RELOAD_MARKER_KEY, '1');
          window.location.reload();
        }
      } catch {
        // Best-effort cleanup only.
      }
    };

    void run();
  }, [pathname]);

  return null;
}
