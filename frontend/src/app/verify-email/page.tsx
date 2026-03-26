'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { m, AnimatePresence } from 'framer-motion';


import { Sparkles, CheckCircle, XCircle, Mail } from 'lucide-react';
import { authService } from '../../services/authService';

function VerifyEmailContent() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your email...');
  const [resendEmail, setResendEmail] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [resendMessage, setResendMessage] = useState('');
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);

  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const redirect = searchParams.get('redirect');
  const router = useRouter();
  const redirectTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing verification token.');
      return;
    }

    const verifyToken = async () => {
      try {
        const data = await authService.verifyEmail(token, redirect || undefined);
        setStatus('success');
        setMessage(data.message || 'Email verified successfully!');

        if (data.token && typeof window !== 'undefined') {
          localStorage.setItem('token', data.token);
          const emailKey = (data.user?.email || '').trim().toLowerCase();
          if (emailKey) {
            localStorage.removeItem(`resendCooldown:${emailKey}`);
            localStorage.removeItem(`resendAttempts:${emailKey}`);
          }
        }

        const redirectUrl = data.redirectUrl || '/dashboard';

        // Redirect to dashboard (or provided redirect) after a short delay
        // Relies on HTTP-only cookie set by backend for authentication
        setRedirectCountdown(3);
        countdownTimerRef.current = window.setInterval(() => {
          setRedirectCountdown((prev) => (prev && prev > 1 ? prev - 1 : 1));
        }, 1000) as unknown as number;
        redirectTimerRef.current = window.setTimeout(() => {
          if (countdownTimerRef.current) {
            window.clearInterval(countdownTimerRef.current);
          }
          router.push(redirectUrl);
        }, 3000) as unknown as number;
      } catch (err: any) {
        setStatus('error');
        setMessage(err.response?.data?.message || 'Verification failed. The link may have expired.');
      }
    };

    verifyToken();

    return () => {
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
      }
    };
  }, [token, redirect, router]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail) return;

    setIsResending(true);
    setResendStatus('idle');
    setResendMessage('');

    try {
      const data = await authService.resendVerification(resendEmail);
      setResendStatus('success');
      setResendMessage(data.message || 'Verification link sent!');
    } catch (err: any) {
      setResendStatus('error');
      setResendMessage(err.response?.data?.message || 'Failed to resend verification link.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-4 w-full">
      {status === 'loading' && (
        <span className="w-12 h-12 border-4 border-[#7C5CFF]/30 border-t-[#7C5CFF] rounded-full animate-spin mb-4"></span>
      )}

      {status === 'success' && (
        <m.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-4">
          <CheckCircle className="w-16 h-16 text-green-500 shadow-glow-primary rounded-full" />
        </m.div>
      )}

      {status === 'error' && (
        <m.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-4">
          <XCircle className="w-16 h-16 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)] rounded-full" />
        </m.div>
      )}

      <h3 className="text-xl font-bold text-white text-center">{message}</h3>

      {status === 'success' && (
        <p className="text-sm text-slate-400">
          Redirecting in {redirectCountdown ?? 3}...
        </p>
      )}

      {status === 'error' && (
        <m.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full mt-6 pt-6 border-t border-white/10"
        >
          <h4 className="text-md font-medium text-white mb-4 text-center">Need a new verification link?</h4>
          <form onSubmit={handleResend} className="flex flex-col space-y-3 w-full">
            <div>
              <label htmlFor="email" className="sr-only">Email address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  className="appearance-none rounded-lg relative block w-full px-3 py-3 pl-10 border border-slate-700 bg-slate-800/50 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF] focus:border-transparent transition-all duration-200 sm:text-sm"
                  placeholder="Enter your email address"
                  disabled={isResending}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isResending || !resendEmail}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-gradient-to-r from-[#7C5CFF] to-[#00D4FF] hover:from-[#6B4EE6] hover:to-[#00BCE6] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#7C5CFF] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {isResending ? 'Sending...' : 'Resend Verification Link'}
            </button>
          </form>

          {resendStatus !== 'idle' && (
            <div className={`mt-3 text-sm text-center ${resendStatus === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {resendMessage}
            </div>
          )}
        </m.div>
      )}
    </div>
  );
}

export default function VerifyEmail() {
  return (
    <div className="min-h-screen bg-[#0B0F1A] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-[#7C5CFF]/30 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] right-[20%] w-[40%] h-[40%] bg-[#7C5CFF] opacity-[0.05] blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] bg-[#00D4FF] opacity-[0.05] blur-[120px] rounded-full"></div>
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
        <div className="bg-[#111827]/80 py-12 px-4 shadow-[0_0_50px_rgba(0,0,0,0.5)] sm:rounded-2xl sm:px-10 border border-[#1A2235] backdrop-blur-xl relative">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-primary opacity-50"></div>

          <Suspense fallback={<div className="text-center text-slate-400">Loading...</div>}>
            <VerifyEmailContent />
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
