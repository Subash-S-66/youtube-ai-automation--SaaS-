'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { authService } from '../../services/authService';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const initAdmin = async () => {
      try {
        const me = await authService.getMe();
        if (!me?.data?.user || me.data.user.role !== 'admin') {
          if (isMounted) router.replace('/dashboard');
          return;
        }
        if (!isMounted) return;
        setCurrentUser({ ...me.data.user, plan: me.data.plan, displayPlan: me.data.displayPlan, isBetaMode: me.data.isBetaMode });
      } catch (error) {
        if (isMounted) router.replace('/login');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    initAdmin();
    return () => { isMounted = false; };
  }, [router]);

  if (loading) {
    return (
      <DashboardLayout user={currentUser}>
        <div className="flex items-center space-x-3 text-slate-400 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin text-[#7C5CFF]" />
          <span>Loading admin...</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={currentUser}>
      {children}
    </DashboardLayout>
  );
}
