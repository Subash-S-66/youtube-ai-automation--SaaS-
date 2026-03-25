'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { m } from 'framer-motion';
import { Sparkles, ArrowRight, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { authService } from '../../services/authService';
import { OtpInput } from '../../components/OtpInput';




export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Verification states
  const [unverified, setUnverified] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [initialResendDelayStarted, setInitialResendDelayStarted] = useState(false);
  const [resendEndAt, setResendEndAt] = useState(0);
  const [resendMessage, setResendMessage] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSuccess, setOtpSuccess] = useState('');
  const [isOtpLoading, setIsOtpLoading] = useState(false);

  const router = useRouter();

  const getEmailKey = (value: string) => value.trim().toLowerCase();
  const getCooldownKey = (value: string) => `resendCooldown:${getEmailKey(value)}`;
  const getAttemptsKey = (value: string) => `resendAttempts:${getEmailKey(value)}`;

  useEffect(() => {
    if (!email) return;
    const cooldownKey = getCooldownKey(email);
    const attemptsKey = getAttemptsKey(email);
    const storedEndAt = Number(localStorage.getItem(cooldownKey) || 0);
    const storedAttempts = Number(localStorage.getItem(attemptsKey) || 0);

    setResendAttempts(Number.isFinite(storedAttempts) ? storedAttempts : 0);

    if (storedEndAt && storedEndAt > Date.now()) {
      setResendEndAt(storedEndAt);
      setInitialResendDelayStarted(true);
    } else {
      setResendEndAt(0);
      setInitialResendDelayStarted(false);
      if (storedEndAt) {
        localStorage.removeItem(cooldownKey);
      }
    }
  }, [email]);

  useEffect(() => {
    if (!resendEndAt) {
      setResendCountdown(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((resendEndAt - Date.now()) / 1000));
      setResendCountdown(remaining);
      if (remaining <= 0) {
        setResendEndAt(0);
        if (email) {
          localStorage.removeItem(getCooldownKey(email));
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [resendEndAt, email]);

  useEffect(() => {
    if (!unverified) {
      setInitialResendDelayStarted(false);
      return;
    }
    if (unverified && !initialResendDelayStarted && email) {
      const endAt = Date.now() + 60 * 1000;
      setResendEndAt(endAt);
      localStorage.setItem(getCooldownKey(email), String(endAt));
      setInitialResendDelayStarted(true);
    }
  }, [unverified, initialResendDelayStarted, email]);


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setUnverified(false);
    setShowOtp(false);

    try {
      const data = await authService.login({ email, password });
      if (data.success && data.data.token) {
        localStorage.setItem('token', data.data.token);
        const emailKey = email.trim().toLowerCase();
        if (emailKey) {
          localStorage.removeItem(`resendCooldown:${emailKey}`);
          localStorage.removeItem(`resendAttempts:${emailKey}`);
        }
        router.push('/dashboard');
      }
    } catch (err: any) {
      if (err.response?.data?.unverified) {
        setUnverified(true);
        setError(''); // Clear standard error to show verification UI
      } else {
        setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
      }
      setIsLoading(false);
    }
  };

  const handleResendEmail = async () => {
    if (resendCountdown > 0) return;

    try {
      await authService.resendVerification(email);
      setResendMessage('Verification email sent!');
      startResendCooldown();
      setTimeout(() => setResendMessage(''), 5000); // clear message after 5s
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to resend verification email.');
    }
  };

  const handleRequestOtp = async () => {
    if (resendCountdown > 0) return;

    try {
      await authService.sendOtp(email);
      setResendMessage('OTP sent to your email!');
      startResendCooldown();
      setShowOtp(true);
      setTimeout(() => setResendMessage(''), 5000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send OTP.');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setOtpError('OTP must be exactly 6 digits');
      return;
    }

    setIsOtpLoading(true);
    setOtpError('');
    setOtpSuccess('');

    try {
      const data = await authService.verifyOtp(email, otp);
      if (data.success && data.token) {
        setOtpSuccess('Email verified successfully!');
        localStorage.setItem('token', data.token);
        const emailKey = email.trim().toLowerCase();
        if (emailKey) {
          localStorage.removeItem(`resendCooldown:${emailKey}`);
          localStorage.removeItem(`resendAttempts:${emailKey}`);
        }
        setTimeout(() => {
          router.push('/dashboard');
        }, 1000);
      }
    } catch (err: any) {
      setOtpError(err.response?.data?.message || 'Failed to verify OTP.');
      setIsOtpLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F1A] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-[#7C5CFF]/30 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[20%] w-[40%] h-[40%] bg-[#7C5CFF] opacity-[0.05] blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[20%] w-[40%] h-[40%] bg-[#00D4FF] opacity-[0.05] blur-[120px] rounded-full"></div>
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
                  className="block w-full pl-10 bg-[#0B0F1A] border border-[#1A2235] rounded-xl py-3 text-slate-200 focus:outline-none border-glow-primary transition-colors sm:text-sm shadow-inner"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center">
                <label className="block text-sm font-medium text-slate-300">Password</label>
                <a href="/forgot-password" className="text-sm font-medium text-[#00D4FF] hover:text-[#7C5CFF] transition-colors">
                  Forgot password?
                </a>
              </div>
              <div className="mt-2 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  className="block w-full pl-10 pr-10 bg-[#0B0F1A] border border-[#1A2235] rounded-xl py-3 text-slate-200 focus:outline-none border-glow-primary transition-colors sm:text-sm shadow-inner"
                  placeholder="********"
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
            {error && !unverified && (
              <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 text-center">
                {error}
              </m.div>
            )}

            {unverified && !showOtp && (
              <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg space-y-3">
                <p className="text-sm text-orange-400 text-center font-medium">Email not verified</p>
                {resendCountdown > 0 ? (
                  <p className="text-xs text-orange-300/70 text-center">
                    You can request a new email or code in {resendCountdown}s.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleResendEmail}
                      className="w-full py-2 px-4 border border-orange-500/30 rounded-lg text-sm font-medium text-orange-300 hover:bg-orange-500/10 transition-colors"
                    >
                      Resend Verification Email
                    </button>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-slate-700"></div>
                      </div>
                      <div className="relative flex justify-center text-xs">
                        <span className="bg-[#111827] px-2 text-slate-400">or</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRequestOtp}
                      className="w-full py-2 px-4 border border-[#00D4FF]/30 rounded-lg text-sm font-medium text-[#00D4FF] hover:bg-[#00D4FF]/10 transition-colors"
                    >
                      Use verification code
                    </button>
                  </div>
                )}
                {resendMessage && <p className="text-xs text-green-400 text-center">{resendMessage}</p>}
              </m.div>
            )}

            {showOtp && (
              <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 bg-slate-800/50 border border-slate-700/50 rounded-xl space-y-4">
                <div className="text-center">
                  <h3 className="text-lg font-bold text-white mb-1">Enter Verification Code</h3>
                  <p className="text-sm text-slate-400">We sent a 6-digit code to {email}</p>
                </div>

                <div className="flex justify-center py-2">
                  <OtpInput
                    length={6}
                    value={otp}
                    onChange={(val) => {
                      setOtp(val);
                      setOtpError('');
                    }}
                    disabled={isOtpLoading}
                  />
                </div>

                {otpError && (
                  <p className="text-sm text-red-400 text-center">{otpError}</p>
                )}

                {otpSuccess && (
                  <p className="text-sm text-green-400 text-center">{otpSuccess}</p>
                )}

                <div className="flex flex-col gap-3">
                  <m.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={isOtpLoading || otp.length !== 6}
                    className="w-full flex justify-center py-2.5 border border-transparent rounded-lg text-sm font-bold text-white bg-gradient-primary hover:shadow-glow-primary transition-all disabled:opacity-50"
                  >
                    {isOtpLoading ? 'Verifying...' : 'Verify & Login'}
                  </m.button>

                  <div className="flex justify-between items-center text-xs">
                    <button
                      type="button"
                      onClick={() => setShowOtp(false)}
                      className="text-slate-400 hover:text-white transition-colors"
                    >
                      Back to login
                    </button>

                    {resendCountdown > 0 ? (
                      <span className="text-slate-500">Resend available in {resendCountdown}s</span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleRequestOtp}
                        className="text-[#00D4FF] hover:text-[#7C5CFF] transition-colors"
                      >
                        Resend code
                      </button>
                    )}
                  </div>
                </div>
              </m.div>
            )}

            {!unverified && !showOtp && (
              <div>
                <m.button
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
                      Sign in to your account
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </m.button>
              </div>
            )}
          </form>

          <div className="mt-8 text-center text-sm text-slate-400">
             New to ClipForge?{' '}
             <a href="/register" className="font-semibold text-[#00D4FF] hover:text-[#7C5CFF] transition-colors">
               Create an account
             </a>
          </div>
        </div>
      </m.div>
    </div>
  );
}



  const startResendCooldown = () => {
    const nextCooldown = resendAttempts === 0 ? 60 : 120;
    const endAt = Date.now() + nextCooldown * 1000;
    setResendEndAt(endAt);
    if (email) {
      localStorage.setItem(getCooldownKey(email), String(endAt));
      const nextAttempts = resendAttempts + 1;
      setResendAttempts(nextAttempts);
      localStorage.setItem(getAttemptsKey(email), String(nextAttempts));
    } else {
      setResendAttempts(resendAttempts + 1);
    }
  };
