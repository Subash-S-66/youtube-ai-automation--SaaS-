'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { m } from 'framer-motion';
import { ArrowRight, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { authService } from '../../services/authService';
import { OtpInput } from '../../components/OtpInput';
import { buildApiUrl } from '../../lib/apiBase';

function RegisterContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
  const [verificationEmail, setVerificationEmail] = useState('');
  const [isSessionChecking, setIsSessionChecking] = useState(true);
  const router = useRouter();

  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref') || undefined;

  const getEmailKey = (value: string) => value.trim().toLowerCase();
  const getCooldownKey = (value: string) => `resendCooldown:${getEmailKey(value)}`;
  const getAttemptsKey = (value: string) => `resendAttempts:${getEmailKey(value)}`;

  useEffect(() => {
    let active = true;

    const checkExistingSession = async () => {
      try {
        const data = await authService.getMe();
        if (active && data?.success) {
          router.replace('/dashboard');
          return;
        }
      } catch {
        // No active session; keep user on register page.
      } finally {
        if (active) {
          setIsSessionChecking(false);
        }
      }
    };

    checkExistingSession();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    const targetEmail = verificationEmail || email;
    if (!targetEmail) return;
    const cooldownKey = getCooldownKey(targetEmail);
    const attemptsKey = getAttemptsKey(targetEmail);
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
  }, [email, verificationEmail]);

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
        const targetEmail = verificationEmail || email;
        if (targetEmail) {
          localStorage.removeItem(getCooldownKey(targetEmail));
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [resendEndAt, email, verificationEmail]);

  useEffect(() => {
    if (!success) {
      setInitialResendDelayStarted(false);
      return;
    }
    const targetEmail = verificationEmail || email;
    if (success && !initialResendDelayStarted && targetEmail) {
      const endAt = Date.now() + 60 * 1000;
      setResendEndAt(endAt);
      localStorage.setItem(getCooldownKey(targetEmail), String(endAt));
      setInitialResendDelayStarted(true);
    }
  }, [success, initialResendDelayStarted, email, verificationEmail]);

  useEffect(() => {
    if (!verificationEmail) return;
    const normalized = email.trim().toLowerCase();
    if (normalized && normalized !== verificationEmail) {
      setSuccess('');
      setResendMessage('');
      setShowOtp(false);
      setOtp('');
      setOtpError('');
      setOtpSuccess('');
      setVerificationEmail('');
    }
  }, [email, verificationEmail]);

  const startResendCooldown = () => {
    const targetEmail = verificationEmail || email;
    const nextCooldown = resendAttempts === 0 ? 60 : 120;
    const endAt = Date.now() + nextCooldown * 1000;
    setResendEndAt(endAt);
    if (targetEmail) {
      localStorage.setItem(getCooldownKey(targetEmail), String(endAt));
      const nextAttempts = resendAttempts + 1;
      setResendAttempts(nextAttempts);
      localStorage.setItem(getAttemptsKey(targetEmail), String(nextAttempts));
    } else {
      setResendAttempts(resendAttempts + 1);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*?&]/.test(password)) {
      setError('Password must contain at least one letter and one number');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');
    setResendMessage('');
    setShowOtp(false);
    setOtp('');
    setOtpError('');
    setOtpSuccess('');
    try {
      const data = await authService.register({ email, password, referralCode: refCode });

      if (data.success) {
        setVerificationEmail(email.trim());
        setSuccess(data.message || 'Registration successful. Please check your email to verify your account.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (typeof window === 'undefined') return;
    const requestNonce = Date.now().toString(36);
    const params = new URLSearchParams({
      r: requestNonce,
      select_account: '1',
    });
    if (refCode) {
      params.set('state', `ref:${refCode}`);
    }
    window.location.href = `${buildApiUrl('/api/auth/google')}?${params.toString()}`;
  };

  const handleResendEmail = async () => {
    if (resendCountdown > 0) return;
    try {
      await authService.resendVerification(verificationEmail || email);
      setResendMessage('Verification email sent.');
      startResendCooldown();
      setTimeout(() => setResendMessage(''), 5000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to resend verification email.');
    }
  };

  const handleRequestOtp = async () => {
    if (resendCountdown > 0) return;
    try {
      await authService.sendOtp(verificationEmail || email);
      setResendMessage('Verification code sent.');
      startResendCooldown();
      setShowOtp(true);
      setTimeout(() => setResendMessage(''), 5000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send verification code.');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setOtpError('Code must be exactly 6 digits');
      return;
    }
    setIsOtpLoading(true);
    setOtpError('');
    setOtpSuccess('');
    try {
      const data = await authService.verifyOtp(verificationEmail || email, otp);
      if (data.success && data.token) {
        setOtpSuccess('Email verified successfully. Redirecting...');

        setTimeout(() => {
          router.push('/dashboard');
        }, 1000);
      }
    } catch (err: any) {
      setOtpError(err.response?.data?.message || 'Failed to verify code.');
      setIsOtpLoading(false);
    }
  };

  if (isSessionChecking) {
    return (
      <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#7C5CFF] border-t-transparent animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F1A] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-[#7C5CFF]/30 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] right-[20%] w-[40%] h-[40%] bg-[#7C5CFF] opacity-[0.05] blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] bg-[#FF4FD8] opacity-[0.05] blur-[120px] rounded-full"></div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md flex justify-center items-center relative z-10">
        <div className="relative mr-3 h-10 w-10 overflow-hidden rounded-xl border border-[#1A2235] bg-white/5">
          <Image
            src="/brand-logo.png"
            alt="Project logo"
            width={40}
            height={40}
            className="h-10 w-10 object-cover"
            priority
          />
        </div>
        <h2 className="text-center text-4xl font-extrabold text-white tracking-tight">
          Clip Forge
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
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="block w-full pl-10 pr-10 bg-[#0B0F1A] border border-[#1A2235] rounded-xl py-3 text-slate-200 focus:outline-none border-glow-primary transition-colors sm:text-sm shadow-inner"
                  placeholder="Min 8 chars, letters & numbers"
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
                {success}
              </m.div>
            )}

            {success && (
              <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 bg-[#0B0F1A]/60 border border-[#1A2235] rounded-lg space-y-3">
                <p className="text-sm text-slate-300 text-center">Didn’t receive the verification email?</p>
                {resendCountdown > 0 ? (
                  <p className="text-xs text-slate-500 text-center">
                    You can request a new email or code in {resendCountdown}s.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleResendEmail}
                      className="w-full py-2 px-4 border border-[#7C5CFF]/30 rounded-lg text-sm font-medium text-[#7C5CFF] hover:bg-[#7C5CFF]/10 transition-colors"
                    >
                      Resend verification email
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

            {success && showOtp && (
              <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-5 bg-slate-800/50 border border-slate-700/50 rounded-xl space-y-4">
                <div className="text-center">
                  <h3 className="text-lg font-bold text-white mb-1">Enter verification code</h3>
                  <p className="text-sm text-slate-400">We sent a 6-digit code to {verificationEmail || email}</p>
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
                    {isOtpLoading ? 'Verifying...' : 'Verify & Continue'}
                  </m.button>
                </div>
              </m.div>
            )}

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
                    Create Account
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </m.button>
            </div>
          </form>

          <div className="mt-8 space-y-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-[#111827] px-2 text-slate-400">or continue with</span>
              </div>
            </div>

            <m.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleGoogleLogin}
              className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-slate-700/60 rounded-full text-sm font-semibold text-white bg-[#0B0F1A] hover:bg-[#0F172A] transition-all"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C17.1 3.5 14.8 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12S6.8 21.5 12 21.5c6.9 0 8.6-4.8 8.6-7.3 0-.5-.1-.9-.1-1.3H12z"/>
                <path fill="#34A853" d="M3.6 7.2l3.2 2.4C7.7 7.6 9.7 6.2 12 6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C17.1 3.5 14.8 2.5 12 2.5c-3.6 0-6.8 2-8.4 4.7z"/>
                <path fill="#4A90E2" d="M12 21.5c2.7 0 5-0.9 6.6-2.5l-3.1-2.4c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.2l-3.3 2.5C4.5 19 8 21.5 12 21.5z"/>
                <path fill="#FBBC05" d="M6.2 13.4c-.2-.6-.3-1.1-.3-1.8s.1-1.2.3-1.8L3 7.2c-.7 1.4-1.1 3-1.1 4.4 0 1.4.4 3 1.1 4.4l3.2-2.6z"/>
              </svg>
              Continue with Google
            </m.button>
          </div>

          <div className="mt-8 text-center text-sm text-slate-400">
             Already have an account?{' '}
             <a href="/login" className="font-semibold text-[#00D4FF] hover:text-[#7C5CFF] transition-colors">
               Sign in instead
             </a>
          </div>
        </div>
      </m.div>
    </div>
  );
}

export default function Register() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-[#7C5CFF] border-t-transparent animate-spin"></div></div>}>
      <RegisterContent />
    </Suspense>
  );
}
