'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sparkles, CheckCircle, XCircle } from 'lucide-react';
import { authService } from '../../services/authService';

function VerifyEmailContent() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your email...');
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const router = useRouter();

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing verification token.');
      return;
    }

    const verifyToken = async () => {
      try {
        const data = await authService.verifyEmail(token);
        setStatus('success');
        setMessage(data.message || 'Email verified successfully!');

        // Redirect to login after 3 seconds
        setTimeout(() => {
          router.push('/login');
        }, 3000);
      } catch (err: any) {
        setStatus('error');
        setMessage(err.response?.data?.message || 'Verification failed. The link may have expired.');
      }
    };

    verifyToken();
  }, [token, router]);

  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      {status === 'loading' && (
        <span className="w-12 h-12 border-4 border-[#7C5CFF]/30 border-t-[#7C5CFF] rounded-full animate-spin mb-4"></span>
      )}

      {status === 'success' && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-4">
          <CheckCircle className="w-16 h-16 text-green-500 shadow-glow-primary rounded-full" />
        </motion.div>
      )}

      {status === 'error' && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mb-4">
          <XCircle className="w-16 h-16 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)] rounded-full" />
        </motion.div>
      )}

      <h3 className="text-xl font-bold text-white text-center">{message}</h3>

      {status === 'success' && (
        <p className="text-sm text-slate-400">Redirecting to login...</p>
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

      <motion.div
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
      </motion.div>
    </div>
  );
}
