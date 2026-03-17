'use client';

import { useState } from 'react';
import { Menu, X, LayoutDashboard, Video, Settings, LogOut, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { authService } from '../../services/authService';

interface LayoutProps {
  children: React.ReactNode;
  user: any;
}

export default function DashboardLayout({ children, user }: LayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    authService.logout();
  };

  const navLinks = [
    { name: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    // Expandable for future routes
  ];

  return (
    <div className="flex h-screen bg-[#0f172a] text-slate-300 font-sans overflow-hidden">

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
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#111827] border-r border-slate-800 shadow-2xl md:relative md:translate-x-0 transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-full flex flex-col">
          {/* Logo Area */}
          <div className="h-16 flex items-center px-6 border-b border-slate-800">
            <Sparkles className="h-6 w-6 text-green-500 mr-2" />
            <span className="text-xl font-bold tracking-wider text-white">Clip<span className="text-green-500">Forge</span></span>
            <button className="ml-auto md:hidden text-slate-400 hover:text-white" onClick={() => setIsMobileMenuOpen(false)}>
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <a
                  key={link.name}
                  href={link.href}
                  className="group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg bg-slate-800/50 text-white transition-all duration-200"
                >
                  <Icon className="text-green-500 mr-3 flex-shrink-0 h-5 w-5" />
                  {link.name}
                </a>
              )
            })}
          </nav>

          {/* User Area / Logout */}
          <div className="p-4 border-t border-slate-800 bg-[#0f172a]/30">
             <div className="flex items-center">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.email || 'Loading...'}</p>
                  <p className="text-xs text-slate-500 capitalize tracking-wider mt-1">{user?.plan} Plan</p>
                </div>
             </div>
             <button
                onClick={handleLogout}
                className="mt-4 w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-lg transition-colors"
             >
               <LogOut className="h-4 w-4 mr-2" />
               Log out
             </button>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 flex-shrink-0 bg-[#111827]/80 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-4 sm:px-6 lg:px-8 z-10">
           <button
             className="md:hidden text-slate-400 hover:text-white"
             onClick={() => setIsMobileMenuOpen(true)}
           >
             <Menu className="h-6 w-6" />
           </button>
           <div className="ml-auto flex items-center">
              <div className="h-8 w-8 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30">
                 <span className="text-green-400 text-xs font-bold">{user?.email?.charAt(0).toUpperCase()}</span>
              </div>
           </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-[#0f172a] p-4 sm:p-6 lg:p-8">
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
    </div>
  );
}
