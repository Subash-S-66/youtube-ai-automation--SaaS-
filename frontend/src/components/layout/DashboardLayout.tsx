'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X, LayoutDashboard, CreditCard, History, Settings, LogOut, Sparkles, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { authService } from '../../services/authService';
import { cn } from '../../lib/utils';
import InstallPwaButton from '../InstallPwaButton';
import InAppNotifications from './InAppNotifications';

interface LayoutProps {
  children: React.ReactNode;
  user: any;
}

export default function DashboardLayout({ children, user }: LayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const handleLogout = () => {
    authService.logout();
  };

  const navLinks = [
    { name: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    { name: 'History', icon: History, href: '/history' },
    { name: 'Payments', icon: CreditCard, href: '/payments' },
    { name: 'Settings', icon: Settings, href: '/settings' },
    { name: 'Help', icon: HelpCircle, href: '/help' },
  ];

  return (
    <div className="flex h-screen bg-[#0B0F1A] text-slate-300 font-sans overflow-hidden">

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 md:hidden backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -300 }}
        animate={{ x: isMobileMenuOpen ? 0 : 0 }}
        className={`fixed inset-y-0 left-0 z-50 w-64 md:w-56 bg-[#111827] border-r border-[#1A2235] shadow-2xl md:relative md:translate-x-0 transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-full flex flex-col">
          {/* Logo Area */}
          <div className="h-16 flex items-center px-6 border-b border-[#1A2235]">
            <Sparkles className="h-6 w-6 text-[#7C5CFF] mr-2 shadow-glow-primary" />
            <span className="text-xl font-bold tracking-wider text-white">Clip<span className="text-gradient-primary">Forge</span></span>
            <button className="ml-auto md:hidden text-slate-400 hover:text-white" onClick={() => setIsMobileMenuOpen(false)}>
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;

              return (
                <a
                  key={link.name}
                  href={link.href}
                  className={cn(
                    "group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 relative",
                    isActive ? "text-white bg-[#1A2235]/80 shadow-[0_2px_10px_rgba(0,0,0,0.2)]" : "text-slate-400 hover:text-white hover:bg-[#1A2235]/40"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-sidebar-nav"
                      className="absolute left-0 w-1 h-6 bg-[#00D4FF] rounded-r-md shadow-[0_0_10px_rgba(0,212,255,0.6)]"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                  <Icon className={cn("mr-3 flex-shrink-0 h-5 w-5 transition-colors", isActive ? "text-[#00D4FF]" : "text-slate-500 group-hover:text-[#7C5CFF]")} />
                  {link.name}
                </a>
              )
            })}
          </nav>

          {/* User Area / Logout */}
          <div className="p-4 border-t border-[#1A2235] bg-[#0B0F1A]/50">
             <div className="flex items-center">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.email || 'Loading...'}</p>
                  <div className="flex items-center mt-1">
                    <p className="text-xs text-[#FF4FD8] capitalize tracking-wider">
                      {user?.displayPlan || user?.plan} Plan
                    </p>
                    {user?.isBetaMode && (
                      <span
                        title="You are currently in beta with PRO access"
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
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Navbar */}
        <header className="sticky top-0 h-16 flex-shrink-0 bg-[#111827]/80 backdrop-blur-xl border-b border-[#1A2235] flex items-center justify-between px-4 sm:px-6 lg:px-8 z-[1000]">
           <button
             className="md:hidden text-slate-400 hover:text-white"
             onClick={() => setIsMobileMenuOpen(true)}
           >
             <Menu className="h-6 w-6" />
           </button>
           <div className="ml-auto flex items-center">
              {/* Install PWA Prompt */}
              <InstallPwaButton />
              <div className="h-8 w-8 rounded-full bg-[#7C5CFF]/20 flex items-center justify-center border border-[#7C5CFF]/30 shadow-glow-primary">
                 <span className="text-[#00D4FF] text-xs font-bold">{user?.email?.charAt(0).toUpperCase() || 'U'}</span>
              </div>
           </div>
        </header>

        {/* Page Content Background (Subtle glow) */}
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#7C5CFF] opacity-[0.03] blur-[100px] rounded-full"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#00D4FF] opacity-[0.03] blur-[100px] rounded-full"></div>
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-[#0B0F1A] p-4 sm:p-6 lg:p-8 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="max-w-6xl mx-auto space-y-6"
          >
            {children}
          </motion.div>
        </main>
      </div>

      {/* Notifications */}
      <InAppNotifications />
    </div>
  );
}
