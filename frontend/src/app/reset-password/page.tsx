'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { m, AnimatePresence } from 'framer-motion';


import { Sparkles, ArrowRight, Lock } from 'lucide-react';
import { authService } from '../../services/authService';

import { Eye, EyeOff } from 'lucide-react';

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Invalid or missing reset token.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const data = await authService.resetPassword({ token, newPassword: password });
      setSuccess(data.message || 'Password reset successfully.');
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleReset}>
      <div>
        <label className="block text-sm font-medium text-slate-300">New Password</label>
        <div className="mt-2 relative rounded-md shadow-sm">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-slate-500" />
          </div>
          <input
                  type={showPassword ? 'text' : 'password'}
            required
                  className="block w-full pl-10 pr-10 bg-[#0B0F1A] border border-[#1A2235] rounded-xl py-3 text-slate-200 focus:outline-none border-glow-primary transition-colors sm:text-sm shadow-inner"
            placeholder="Min 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 focus:outline-none"
                >
                  {showPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">Confirm Password</label>
              <div className="mt-2 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  className="block w-full pl-10 pr-10 bg-[#0B0F1A] border border-[#1A2235] rounded-xl py-3 text-slate-200 focus:outline-none border-glow-primary transition-colors sm:text-sm shadow-inner"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 focus:outline-none"
                >
                  {showConfirmPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                </button>
              </div>
            </div>

      {error && (
        <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 text-center">
          {error}
        </m.div>
      )}

      {success && (
        <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-400 text-center">
          {success} Redirecting to login...
        </m.div>
      )}

      <div>
        <m.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="submit"
          disabled={isLoading || !!success}
          className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-full shadow-glow-primary hover:shadow-glow-primary-hover text-sm font-bold text-white bg-gradient-primary transition-all disabled:opacity-50"
        >
          {isLoading ? (
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          ) : (
            <>
              Update Password
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </m.button>
      </div>
    </form>
  );
}

export default function ResetPassword() {
  return (
    <div className="min-h-screen bg-[#0B0F1A] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-[#7C5CFF]/30 relative overflow-hidden">
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

      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10"
      >
        <div className="bg-[#111827]/80 py-10 px-4 shadow-[0_0_50px_rgba(0,0,0,0.5)] sm:rounded-2xl sm:px-10 border border-[#1A2235] backdrop-blur-xl relative">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-primary opacity-50"></div>

          <h3 className="text-center text-xl font-bold text-white mb-6">Create New Password</h3>

          <Suspense fallback={<div className="text-center text-slate-400">Loading...</div>}>
            <ResetPasswordForm />
          </Suspense>

          <div className="mt-8 text-center text-sm text-slate-400">
             <a href="/login" className="font-semibold text-[#00D4FF] hover:text-[#7C5CFF] transition-colors">
               Return to Login
             </a>
          </div>
        </div>
      </m.div>
    </div>
  );
}
