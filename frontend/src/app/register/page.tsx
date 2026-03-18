'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight, Mail, Lock } from 'lucide-react';
import { authService } from '../../services/authService';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const data = await authService.register({ email, password });
      if (data.success && data.data.token) {
        localStorage.setItem('token', data.data.token);
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F1A] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-[#7C5CFF]/30 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] right-[20%] w-[40%] h-[40%] bg-[#7C5CFF] opacity-[0.05] blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] bg-[#FF4FD8] opacity-[0.05] blur-[120px] rounded-full"></div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md flex justify-center items-center relative z-10">
        <div className="relative mr-3">
          <Sparkles className="h-8 w-8 text-[#7C5CFF]" />
          <div className="absolute inset-0 bg-[#7C5CFF] blur-xl opacity-50 rounded-full"></div>
        </div>
        <h2 className="text-center text-4xl font-extrabold text-white tracking-tight">
          Clip<span className="text-gradient-primary">Forge</span>
        </h2>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10"
      >
        <div className="bg-[#111827]/80 py-10 px-4 shadow-[0_0_50px_rgba(0,0,0,0.5)] sm:rounded-2xl sm:px-10 border border-[#1A2235] backdrop-blur-xl relative">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-primary opacity-50"></div>

          <form className="space-y-6" onSubmit={handleRegister}>
            <div>
              <label className="block text-sm font-medium text-slate-300">Email address</label>
              <div className="mt-2 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="email"
                  required
                  className="block w-full pl-10 bg-[#0B0F1A] border border-[#1A2235] rounded-xl py-3 text-slate-200 focus:outline-none border-glow-primary transition-colors sm:text-sm shadow-inner"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">Password</label>
              <div className="mt-2 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="password"
                  required
                  className="block w-full pl-10 bg-[#0B0F1A] border border-[#1A2235] rounded-xl py-3 text-slate-200 focus:outline-none border-glow-primary transition-colors sm:text-sm shadow-inner"
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 text-center">
                {error}
              </motion.div>
            )}

            <div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-full shadow-glow-primary hover:shadow-glow-primary-hover text-sm font-bold text-white bg-gradient-primary transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                ) : (
                  <>
                    Create Account
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </motion.button>
            </div>
          </form>

          <div className="mt-8 text-center text-sm text-slate-400">
             Already have an account?{' '}
             <a href="/login" className="font-semibold text-[#00D4FF] hover:text-[#7C5CFF] transition-colors">
               Sign in instead
             </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
