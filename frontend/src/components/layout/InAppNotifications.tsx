"use client";

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Info, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import api from '../../lib/api';

interface Notification {
  _id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'critical';
  createdAt: string;
}

export default function InAppNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [visibleNotification, setVisibleNotification] = useState<Notification | null>(null);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await api.get('/notifications');
        const data = res.data;
        if (data.success && data.data.length > 0) {
          const fetchedNotifications: Notification[] = data.data;

          // Get seen IDs from localStorage
          const seenStr = localStorage.getItem('seenNotifications');
          const seenIds: string[] = seenStr ? JSON.parse(seenStr) : [];

          // Filter out seen ones
          const unseen = fetchedNotifications.filter(n => !seenIds.includes(n._id));

          if (unseen.length > 0) {
            setNotifications(unseen);
            // Show the first unseen notification
            setVisibleNotification(unseen[0]);
          }
        }
      } catch (error) {
        console.error('Failed to fetch in-app notifications', error);
      }
    };

    fetchNotifications();
  }, []);

  const handleDismiss = () => {
    if (!visibleNotification) return;

    // Save to localStorage
    const seenStr = localStorage.getItem('seenNotifications');
    const seenIds: string[] = seenStr ? JSON.parse(seenStr) : [];
    seenIds.push(visibleNotification._id);
    localStorage.setItem('seenNotifications', JSON.stringify(seenIds));

    // Remove from current list
    const remaining = notifications.filter(n => n._id !== visibleNotification._id);
    setNotifications(remaining);

    // Show next or null
    if (remaining.length > 0) {
      setTimeout(() => {
        setVisibleNotification(remaining[0]);
      }, 500); // slight delay before showing next
    } else {
      setVisibleNotification(null);
    }
  };

  return (
    <AnimatePresence>
      {visibleNotification && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
          className="fixed bottom-6 right-6 z-[100] max-w-sm w-full bg-[#111827] border border-[#1A2235] rounded-xl shadow-2xl p-4"
        >
          <div className="flex items-start">
            <div className="flex-shrink-0 mt-0.5">
              {visibleNotification.type === 'critical' ? (
                <AlertCircle className="h-5 w-5 text-red-500" />
              ) : visibleNotification.type === 'warning' ? (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              ) : (
                <Info className="h-5 w-5 text-[#00D4FF]" />
              )}
            </div>
            <div className="ml-3 w-0 flex-1">
              <p className="text-sm font-bold text-white">
                {visibleNotification.title}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {visibleNotification.message}
              </p>
            </div>
            <div className="ml-4 flex-shrink-0 flex">
              <button
                type="button"
                onClick={handleDismiss}
                className="bg-[#111827] rounded-md inline-flex text-slate-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#7C5CFF]"
              >
                <span className="sr-only">Close</span>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
