"use client";

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function GlobalBanner() {
  const [banner, setBanner] = useState<{ message: string; isActive: boolean; type: 'info'|'warning'|'critical' } | null>(null);

  useEffect(() => {
    if (banner && banner.isActive) {
      document.body.classList.add('has-global-banner');
    } else {
      document.body.classList.remove('has-global-banner');
    }

    return () => {
      document.body.classList.remove('has-global-banner');
    };
  }, [banner]);

  useEffect(() => {
    const fetchBanner = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/banner`);
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

    // Poll every 15 seconds
    const intervalId = setInterval(fetchBanner, 15000);
    return () => clearInterval(intervalId);
  }, []);

  if (!banner || !banner.isActive) return null;

  const currentStyle = banner.type === 'critical' ? 'banner-critical' : banner.type === 'warning' ? 'banner-warning' : 'banner-info';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: '40px' }}
        exit={{ opacity: 0, height: 0 }}
        className={`w-full font-medium overflow-hidden z-[100] fixed top-0 left-0 flex items-center shadow-md ${currentStyle}`}
      >
        <div className="relative w-full h-full flex items-center overflow-hidden">
          <motion.div
            className="whitespace-nowrap flex items-center h-full min-w-full"
            initial={{ x: '100vw' }}
            animate={{ x: '-100vw' }}
            transition={{
              repeat: Infinity,
              duration: 20,
              ease: 'linear',
            }}
          >
            <span className="px-8 inline-block align-middle">{banner.message}</span>
            <span className="px-8 inline-block align-middle">{banner.message}</span>
            <span className="px-8 inline-block align-middle">{banner.message}</span>
            <span className="px-8 inline-block align-middle">{banner.message}</span>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
