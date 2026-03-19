"use client";

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function GlobalBanner() {
  const [banner, setBanner] = useState<{ message: string; isActive: boolean } | null>(null);

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

    // Poll every 60 seconds
    const intervalId = setInterval(fetchBanner, 60000);
    return () => clearInterval(intervalId);
  }, []);

  if (!banner || !banner.isActive) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: '32px' }}
        exit={{ opacity: 0, height: 0 }}
        className="w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-medium overflow-hidden z-[100] relative"
      >
        <div className="relative w-full h-8 flex items-center overflow-hidden">
          <motion.div
            className="whitespace-nowrap flex items-center h-full"
            initial={{ x: '100%' }}
            animate={{ x: '-100%' }}
            transition={{
              repeat: Infinity,
              duration: 25,
              ease: 'linear',
            }}
          >
            <span className="px-8">{banner.message}</span>
            <span className="px-8">{banner.message}</span>
            <span className="px-8">{banner.message}</span>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
