'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Menu, X, LayoutDashboard, CreditCard, History, Settings, LogOut, HelpCircle, Shield, Users, MessageSquare } from 'lucide-react';
import { authService } from '../../services/authService';
import { cn } from '../../lib/utils';
import InstallPwaButton from '../InstallPwaButton';
import { getApiBase } from '../../lib/apiBase';

const InAppNotifications = dynamic(() => import('./InAppNotifications'), { ssr: false });

interface LayoutProps {
  children: React.ReactNode;
  user: any;
}

export default function DashboardLayout({ children, user }: LayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isBackendOffline, setIsBackendOffline] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const pathname = usePathname();
  const displayUser = user?.user
    ? {
        ...user.user,
        plan: user.plan ?? user.user.plan,
        displayPlan: user.displayPlan ?? user.user.displayPlan,
        isBetaMode: user.isBetaMode ?? user.user.isBetaMode,
      }
    : user || null;
  const isAdminRoute = pathname.startsWith('/admin');
  const isWidePage = pathname === '/pricing';

  const handleLogout = () => {
    authService.logout();
  };

  useEffect(() => {
    let retryTimer: number | null = null;

    const handleOffline = () => setIsBackendOffline(true);
    const handleOnline = () => setIsBackendOffline(false);
    window.addEventListener('api-offline', handleOffline);
    window.addEventListener('api-online', handleOnline);

    const apiBase = getApiBase();
    const checkServer = async () => {
      try {
        const res = await fetch(`${apiBase}/`, { method: 'GET' });
        if (res.ok) {
          setIsBackendOffline(false);
        }
      } catch {
        // keep offline
      }
    };

    if (isBackendOffline) {
      retryTimer = window.setInterval(() => {
        checkServer();
      }, 10000) as unknown as number;
    }

    return () => {
      window.removeEventListener('api-offline', handleOffline);
      window.removeEventListener('api-online', handleOnline);
      if (retryTimer) window.clearInterval(retryTimer);
    };
  }, [isBackendOffline]);

  useEffect(() => {
    setAvatarError(false);
  }, [displayUser?.profileImage]);

  const navLinks = [
    { name: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    { name: 'History', icon: History, href: '/history' },
    { name: 'Subscriptions', icon: CreditCard, href: '/subscription' },
    { name: 'Settings', icon: Settings, href: '/settings' },
    { name: 'Help', icon: HelpCircle, href: '/help' },
  ];
  if (displayUser?.role === 'admin') {
    navLinks.push({ name: 'Admin Panel', icon: Shield, href: '/admin' });
  }

  return (
    <div className="dashboard-shell flex min-h-0 bg-[#0B0F1A] text-slate-300 font-sans overflow-hidden">

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div
          className="dashboard-mobile-overlay fixed inset-0 z-40 bg-black/60 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`dashboard-sidebar fixed inset-y-0 left-0 z-50 w-64 md:w-56 bg-[#111827] border-r border-[#1A2235] shadow-2xl md:relative md:translate-x-0 transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-full min-h-0 flex flex-col overflow-y-auto">
          {/* Logo Area */}
          <div className="h-16 flex items-center px-6 border-b border-[#1A2235]">
            <div className="mr-2 h-8 w-8 overflow-hidden rounded-lg border border-[#1A2235] bg-white/5">
              <Image
                src="/brand-logo.png"
                alt="Project logo"
                width={32}
                height={32}
                className="h-8 w-8 object-cover"
                priority
              />
            </div>
            <span className="font-bold tracking-wide text-white">Clip Forge</span>
            <button
              aria-label="Close sidebar menu"
              className="ml-auto md:hidden text-slate-400 hover:text-white"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 min-h-0 px-4 py-6 space-y-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;

              if (link.href === '/admin') {
                const showAdminSubmenu = pathname.startsWith('/admin/users') || pathname.startsWith('/admin/tickets');
                return (
                  <div key={link.name} className="relative group">
                    <Link
                      href={link.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={cn(
                        "group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 relative",
                        pathname.startsWith('/admin') ? "text-white bg-[#1A2235]/80 shadow-[0_2px_10px_rgba(0,0,0,0.2)]" : "text-slate-400 hover:text-white hover:bg-[#1A2235]/40"
                      )}
                    >
                      {pathname.startsWith('/admin') && (
                        <div className="absolute left-0 w-1 h-6 bg-[#00D4FF] rounded-r-md shadow-[0_0_10px_rgba(0,212,255,0.6)]" />
                      )}
                      <Icon className={cn("mr-3 flex-shrink-0 h-5 w-5 transition-colors", pathname.startsWith('/admin') ? "text-[#00D4FF]" : "text-slate-500 group-hover:text-[#7C5CFF]")} />
                      {link.name}
                    </Link>

                    <div
                      className={cn(
                        "pl-8 mt-1 space-y-1 transition-all duration-200",
                        showAdminSubmenu ? "opacity-100 max-h-40" : "opacity-0 max-h-0 overflow-hidden",
                        "group-hover:opacity-100 group-hover:max-h-40"
                      )}
                    >
                      <Link
                        href="/admin/users"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={cn(
                          "flex items-center px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200",
                          pathname === '/admin/users' ? "text-white bg-[#1A2235]/80" : "text-slate-400 hover:text-white hover:bg-[#1A2235]/40"
                        )}
                      >
                        <Users className={cn("mr-2 h-4 w-4", pathname === '/admin/users' ? "text-[#00D4FF]" : "text-slate-500")} />
                        Users Directory
                      </Link>
                      <Link
                        href="/admin/tickets"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={cn(
                          "flex items-center px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200",
                          pathname === '/admin/tickets' ? "text-white bg-[#1A2235]/80" : "text-slate-400 hover:text-white hover:bg-[#1A2235]/40"
                        )}
                      >
                        <MessageSquare className={cn("mr-2 h-4 w-4", pathname === '/admin/tickets' ? "text-[#00D4FF]" : "text-slate-500")} />
                        Support Tickets
                      </Link>
                    </div>
                  </div>
                );
              }

              return (
                <Link
                  key={link.name}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 relative",
                    isActive ? "text-white bg-[#1A2235]/80 shadow-[0_2px_10px_rgba(0,0,0,0.2)]" : "text-slate-400 hover:text-white hover:bg-[#1A2235]/40"
                  )}
                >
                  {isActive && <div className="absolute left-0 w-1 h-6 bg-[#00D4FF] rounded-r-md shadow-[0_0_10px_rgba(0,212,255,0.6)]" />}
                  <Icon className={cn("mr-3 flex-shrink-0 h-5 w-5 transition-colors", isActive ? "text-[#00D4FF]" : "text-slate-500 group-hover:text-[#7C5CFF]")} />
                  {link.name}
                </Link>
              );
            })}
          </nav>

          {/* User Area / Logout */}
          <div className="p-4 border-t border-[#1A2235] bg-[#0B0F1A]/50">
             <div className="flex items-center">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{displayUser?.email || 'Loading...'}</p>
                  <div className="flex items-center mt-1">
                    <p className="text-xs text-[#FF4FD8] capitalize tracking-wider">
                      {displayUser?.displayPlan || displayUser?.plan} Plan
                    </p>
                    {displayUser?.isBetaMode && (
                      <span
                        title="You are currently in beta with Basic access"
                        className="ml-2 px-1.5 py-0.5 text-[10px] font-bold bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/30 rounded cursor-help"
                      >
                        BETA
                      </span>
                    )}
                  </div>
                </div>
             </div>
             <button
                onClick={handleLogout}
                className="mt-4 w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-300 bg-[#111827] hover:bg-[#1A2235] hover:text-white rounded-lg transition-colors border border-[#1A2235]"
             >
               <LogOut className="h-4 w-4 mr-2" />
               Log out
             </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">

        {/* Top Navbar */}
        <header className="sticky top-0 h-16 flex-shrink-0 bg-[#111827]/80 backdrop-blur-xl border-b border-[#1A2235] flex items-center justify-between px-4 sm:px-6 lg:px-8 z-[1000]">
           <button
             aria-label="Open sidebar menu"
             className="md:hidden text-slate-400 hover:text-white"
             onClick={() => setIsMobileMenuOpen(true)}
           >
             <Menu className="h-6 w-6" />
           </button>
           <div className="flex-1 flex justify-center ml-4 mr-4">
             {displayUser?.subscriptionExpiresAt && (new Date(displayUser.subscriptionExpiresAt).getTime() - new Date().getTime()) / (1000 * 3600 * 24) <= 3 && (
               <div className="bg-amber-500/15 border border-amber-500/40 text-amber-300 px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-3">
                 <span className="animate-pulse">Warning:</span>
                 <span>
                   your {displayUser.displayPlan || displayUser.plan} plan expires in {Math.ceil((new Date(displayUser.subscriptionExpiresAt).getTime() - new Date().getTime()) / (1000 * 3600 * 24))} days.
                 </span>
                 <Link
                   href="/subscription"
                   className="ml-2 px-3 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-200 border border-amber-400/40 hover:border-amber-300/80 hover:text-amber-100 transition-all"
                 >
                   Renew Now
                 </Link>
               </div>
             )}
           </div>
           <div className="ml-auto flex items-center">
              {/* Install PWA Prompt */}

              <InstallPwaButton />
              {displayUser?.profileImage && !avatarError ? (
                <img
                  src={displayUser.profileImage}
                  alt="Profile"
                  className="h-8 w-8 rounded-full object-cover border border-[#7C5CFF]/30 shadow-glow-primary"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-[#7C5CFF]/20 flex items-center justify-center border border-[#7C5CFF]/30 shadow-glow-primary">
                  <span className="text-[#00D4FF] text-xs font-bold">{displayUser?.email?.charAt(0).toUpperCase() || 'U'}</span>
                </div>
              )}
           </div>
        </header>
        {isBackendOffline && (
          <div className="bg-red-500/10 border-b border-red-500/30 text-red-300 text-xs font-semibold px-4 py-2 text-center flex items-center justify-center gap-2">
            <span className="inline-block h-3.5 w-3.5 border-2 border-red-300/40 border-t-red-300 rounded-full animate-spin"></span>
            Server offline, retrying every 10s…
          </div>
        )}

        {/* Page Content Background (Subtle glow) */}
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#7C5CFF] opacity-[0.03] blur-[100px] rounded-full"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#00D4FF] opacity-[0.03] blur-[100px] rounded-full"></div>
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-[#0B0F1A] p-4 sm:p-6 lg:p-8 relative z-10">
          <div className={cn("mx-auto space-y-6", isWidePage ? "max-w-none" : "max-w-6xl")}>
            {children}
          </div>
        </main>
      </div>

      {/* Notifications */}
      {!isAdminRoute && <InAppNotifications />}
    </div>
  );
}
