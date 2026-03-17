'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight, Mail, Lock } from 'lucide-react';
import { authService } from '../../services/authService';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const data = await authService.login({ email, password });
      if (data.success && data.data.token) {
        localStorage.setItem('token', data.data.token);
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-green-500/30">
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex justify-center items-center">
        <Sparkles className="h-8 w-8 text-green-500 mr-3" />
        <h2 className="text-center text-4xl font-extrabold text-white tracking-tight">
          Clip<span className="text-green-500">Forge</span>
        </h2>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mt-8 sm:mx-auto sm:w-full sm:max-w-md"
      >
        <div className="bg-[#111827] py-10 px-4 shadow-2xl sm:rounded-2xl sm:px-10 border border-slate-800/50 backdrop-blur-xl">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label className="block text-sm font-medium text-slate-300">Email address</label>
              <div className="mt-2 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="email"
                  required
                  className="block w-full pl-10 bg-[#0f172a] border border-slate-700 rounded-lg py-3 text-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 transition-colors sm:text-sm"
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
                  className="block w-full pl-10 bg-[#0f172a] border border-slate-700 rounded-lg py-3 text-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 transition-colors sm:text-sm"
                  placeholder="••••••••"
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
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-[#0f172a] bg-green-500 hover:bg-green-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#111827] focus:ring-green-500 transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="w-5 h-5 border-2 border-slate-800 border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <>
                    Sign in to your account
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </motion.button>
            </div>
          </form>

          <div className="mt-8 text-center text-sm text-slate-400">
             New to ClipForge?{' '}
             <a href="/register" className="font-semibold text-green-500 hover:text-green-400 transition-colors">
               Create an account
             </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
