'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Menu,
  X,
  Star,
  PlayCircle,
  PenSquare,
  Wand2,
  Mic,
  Film,
  UploadCloud,
  Clock,
  Youtube,
  Type,
  ChevronDown,
  Check,
  CircleDashed,
  Activity,
  TrendingUp,
  Rocket,
  Command,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';

type HowStep = {
  title: string;
  description: string;
  icon: LucideIcon;
};

type FeatureCard = {
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  tag: string;
};

type PlanCard = {
  name: string;
  price: string;
  features: string[];
  cta: string;
  highlight?: 'basic' | 'pro';
};

type Testimonial = {
  quote: string;
  author: string;
  followers: string;
  initials: string;
  avatarBg: string;
};

type CommandCenterCard = {
  title: string;
  metric: string;
  description: string;
  icon: LucideIcon;
  accent: string;
};

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Command Center', href: '#command-center' },
];

const howItWorksSteps: HowStep[] = [
  {
    title: 'Write a Prompt',
    description:
      "Type any topic, idea, or niche. ClipForge's AI engine generates a viral-ready script with hooks, structure, and hashtags.",
    icon: PenSquare,
  },
  {
    title: 'AI Writes the Script',
    description:
      'Gemini AI crafts a fully structured narration script optimized for YouTube Shorts retention — complete with a hook, body, and CTA.',
    icon: Wand2,
  },
  {
    title: 'Voice & Visuals Added',
    description:
      'Choose from 5 Gemini native audio voices. Stock clips and images are automatically matched scene-by-scene to your narration.',
    icon: Mic,
  },
  {
    title: 'Video Assembled',
    description:
      'Captions are burned in with your chosen font, color, position, and animation style. Background music is optionally layered in.',
    icon: Film,
  },
  {
    title: 'Auto-Uploaded to YouTube',
    description:
      'The finished Short is uploaded directly to your connected YouTube channel — with title, description, tags, and scheduling handled automatically.',
    icon: UploadCloud,
  },
];

const featureCards: FeatureCard[] = [
  {
    title: 'AI Script Engine',
    description:
      'Gemini AI writes complete narration scripts with viral hooks, structured body, and strong endings. Supports Story Mode for multi-part series.',
    icon: Sparkles,
    color: '#00D4FF',
    tag: 'Gemini Powered',
  },
  {
    title: '5 Premium AI Voices',
    description:
      'Choose from Aoede, Charon, Fenrir, Kore, and Puck — all Gemini Flash native audio voices. Enable random voice rotation for variety.',
    icon: Mic,
    color: '#7C5CFF',
    tag: 'Native Audio',
  },
  {
    title: 'Auto Stock Media',
    description:
      'Pexels and Pixabay APIs automatically fetch cinematic b-roll clips and images scene-by-scene. Or upload your own custom media library.',
    icon: Film,
    color: '#FF4FD8',
    tag: 'Pexels + Pixabay',
  },
  {
    title: 'Multi-Channel YouTube',
    description:
      'Connect multiple YouTube channels and assign per-channel settings, topics, and schedules. Each channel maintains its own state.',
    icon: Youtube,
    color: '#FF4FD8',
    tag: 'Up to 50 Channels',
  },
  {
    title: 'Smart Scheduling',
    description:
      'Schedule one-time uploads or set recurring auto-upload intervals (e.g., every 4 hours). Set it and forget it — ClipForge handles the rest.',
    icon: Clock,
    color: '#00D4FF',
    tag: 'Auto-Pilot Mode',
  },
  {
    title: 'Custom Subtitle Styling',
    description:
      'Control font (Anton, Bebas Neue, Montserrat), color, position (top/middle/bottom), animation (fade, slide, pop), and max words per caption.',
    icon: Type,
    color: '#7C5CFF',
    tag: 'Full Customization',
  },
];

const planCards: PlanCard[] = [
  {
    name: 'FREE',
    price: '$0/mo',
    features: ['2 videos/day', '1 YouTube channel', 'Standard voices', 'No scheduling'],
    cta: 'Get Started',
  },
  {
    name: 'BASIC',
    price: '$10/mo',
    features: ['10 videos/day', '3 YouTube channels', 'Story Mode & Scheduling', 'Email support'],
    cta: 'Upgrade to Basic',
    highlight: 'basic',
  },
  {
    name: 'PRO',
    price: '$25/mo',
    features: [
      '25 videos/day',
      '10 YouTube channels',
      'Priority generation queue',
      'Premium AI voices',
      'Priority support',
    ],
    cta: 'Upgrade to Pro',
    highlight: 'pro',
  },
  {
    name: 'PREMIUM',
    price: '$99/mo',
    features: ['100 videos/day', '50 YouTube channels', 'Instant queue', 'All voices unlocked', '24/7 dedicated support'],
    cta: 'Go Premium',
  },
];

const testimonials: Testimonial[] = [
  {
    quote: 'ClipForge is insane. I went from 0 to posting 3 Shorts daily with zero editing work.',
    author: '@techcreator_sam',
    followers: '42K followers',
    initials: 'TS',
    avatarBg: 'bg-cyan-500/20 text-cyan-300',
  },
  {
    quote: 'The Story Mode feature is a game-changer. My series gets 3x more watch time.',
    author: '@aiexplained',
    followers: '128K followers',
    initials: 'AE',
    avatarBg: 'bg-violet-500/20 text-violet-300',
  },
  {
    quote: 'Set up auto-upload and just woke up with 5 new videos live. This is the future.',
    author: '@shortsfactory',
    followers: '89K followers',
    initials: 'SF',
    avatarBg: 'bg-fuchsia-500/20 text-fuchsia-300',
  },
];

const faqItems = [
  {
    question: 'Do I need a YouTube API key?',
    answer:
      'No, you just connect your YouTube account via Google OAuth in the dashboard. ClipForge handles all the API calls.',
  },
  {
    question: 'Can I use my own video footage?',
    answer:
      'Yes. Upload custom videos, images, and thumbnails to your Media Library and enable "Use Custom Media" when generating.',
  },
  {
    question: 'What AI generates the scripts?',
    answer:
      'Google Gemini (gemini-flash-lite by default). The content_generator module falls back to additional Gemini keys if one is rate-limited.',
  },
  {
    question: 'How does Story Mode work?',
    answer:
      'Enable Story Mode and ClipForge tracks part numbers and story context across generations, automatically feeding prior context into each new episode.',
  },
  {
    question: 'Is there a free trial?',
    answer: 'The Free plan is permanent — 2 videos per day, no credit card required. Upgrade any time from the dashboard.',
  },
  {
    question: 'Can I cancel anytime?',
    answer: 'Yes. Plans are 30-day subscriptions with no contracts. You keep your plan until the end of the billing period.',
  },
];

const pipelineStages = [
  'Crafting Hook + Script...',
  'Matching Cinematic B-Roll...',
  'Layering Voice + Music...',
  'Publishing to YouTube...',
  'Short Delivered ✓',
];

const statTargets = [10, 50, 49, 992];

const commandCenterCards: CommandCenterCard[] = [
  {
    title: 'Retention Blueprint',
    metric: '3.2x',
    description: 'Hook templates, pacing curves, and CTA timing tuned for Shorts watch-time.',
    icon: Activity,
    accent: 'from-[#00D4FF]/20 to-transparent',
  },
  {
    title: 'Upload Velocity',
    metric: '24/7',
    description: 'Always-on queue engine schedules and publishes continuously across channels.',
    icon: Rocket,
    accent: 'from-[#7C5CFF]/20 to-transparent',
  },
  {
    title: 'Growth Signals',
    metric: '+91%',
    description: 'Topic feedback loops adapt upcoming prompts from channel-level performance.',
    icon: TrendingUp,
    accent: 'from-[#FF4FD8]/20 to-transparent',
  },
];

const tickerItems = [
  'Gemini Script Engine',
  '5 Native Voices',
  'Story Mode Sequencing',
  'Auto Upload Scheduler',
  'Channel-Aware Prompts',
  'Caption Style Presets',
];

const starField = [
  { top: '8%', left: '14%', size: 2 },
  { top: '18%', left: '78%', size: 2 },
  { top: '36%', left: '8%', size: 1 },
  { top: '42%', left: '88%', size: 2 },
  { top: '62%', left: '12%', size: 2 },
  { top: '70%', left: '82%', size: 1 },
  { top: '84%', left: '28%', size: 2 },
  { top: '88%', left: '70%', size: 1 },
];

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isHeaderElevated, setIsHeaderElevated] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [pipelineStageIndex, setPipelineStageIndex] = useState(0);
  const [commandCenterIndex, setCommandCenterIndex] = useState(0);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [statsStarted, setStatsStarted] = useState(false);
  const [statValues, setStatValues] = useState([0, 0, 0, 0]);
  const statsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = () => {
      setIsHeaderElevated(window.scrollY > 18);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setPipelineProgress((current) => {
        const next = current + 4;
        if (next > 100) {
          setPipelineStageIndex((idx) => (idx + 1) % pipelineStages.length);
          return 0;
        }
        return next;
      });
    }, 120);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCommandCenterIndex((current) => (current + 1) % commandCenterCards.length);
    }, 2300);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!statsRef.current || statsStarted) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setStatsStarted(true);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(statsRef.current);
    return () => observer.disconnect();
  }, [statsStarted]);

  useEffect(() => {
    if (!statsStarted) return;
    const durationMs = 1600;
    const startAt = performance.now();
    let rafId = 0;

    const animate = (timestamp: number) => {
      const progress = Math.min((timestamp - startAt) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setStatValues(statTargets.map((target) => Math.floor(target * eased)));
      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [statsStarted]);

  const displayedStage = pipelineStages[pipelineStageIndex] || pipelineStages[0];
  const displayedStats = useMemo(
    () => [
      `${statValues[0].toLocaleString()}+`,
      `${statValues[1].toLocaleString()}+`,
      `${(statValues[2] / 10).toFixed(1)}★`,
      `${(statValues[3] / 10).toFixed(1)}%`,
    ],
    [statValues]
  );

  return (
    <div className="min-h-screen overflow-x-clip bg-[#0B0F1A] text-[#F8FAFC]">
      <style jsx global>{`
        @keyframes landingBlobDriftA {
          0% {
            transform: translate3d(-2%, -2%, 0) scale(1);
          }
          100% {
            transform: translate3d(6%, 4%, 0) scale(1.05);
          }
        }
        @keyframes landingBlobDriftB {
          0% {
            transform: translate3d(2%, 2%, 0) scale(1);
          }
          100% {
            transform: translate3d(-5%, -4%, 0) scale(1.07);
          }
        }
        @keyframes landingAuroraSweep {
          0% {
            transform: translate3d(-30%, 0, 0) rotate(-10deg);
            opacity: 0.2;
          }
          100% {
            transform: translate3d(35%, 0, 0) rotate(-10deg);
            opacity: 0.35;
          }
        }
        @keyframes landingGradientShimmer {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        @keyframes landingSpinSlow {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        @keyframes landingFloatA {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(0, -10px, 0);
          }
        }
        @keyframes landingFloatB {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(0, 8px, 0);
          }
        }
        @keyframes landingPulseGlow {
          0% {
            box-shadow: 0 0 0 0 rgba(0, 212, 255, 0.45);
          }
          100% {
            box-shadow: 0 0 0 12px rgba(0, 212, 255, 0);
          }
        }
        @keyframes landingTicker {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(-50%, 0, 0);
          }
        }
        @keyframes landingTwinkle {
          0% {
            opacity: 0.3;
            transform: scale(1);
          }
          100% {
            opacity: 0.95;
            transform: scale(1.35);
          }
        }
        .landing-blob-a {
          animation: landingBlobDriftA 20s ease-in-out infinite alternate;
        }
        .landing-blob-b {
          animation: landingBlobDriftB 20s ease-in-out infinite alternate;
        }
        .landing-grid-overlay {
          background-image:
            linear-gradient(rgba(124, 92, 255, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 212, 255, 0.08) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: radial-gradient(circle at center, rgba(0, 0, 0, 0.75), transparent 80%);
        }
        .landing-aurora {
          animation: landingAuroraSweep 16s ease-in-out infinite alternate;
          background: linear-gradient(90deg, rgba(0, 212, 255, 0) 0%, rgba(0, 212, 255, 0.22) 35%, rgba(124, 92, 255, 0.26) 50%, rgba(255, 79, 216, 0.22) 65%, rgba(255, 79, 216, 0) 100%);
        }
        .landing-shimmer {
          background-image: linear-gradient(135deg, rgba(11, 15, 26, 0.95), rgba(17, 24, 39, 0.9), rgba(11, 15, 26, 0.95));
          background-size: 220% 220%;
          animation: landingGradientShimmer 7s ease infinite;
        }
        .landing-orbit {
          animation: landingSpinSlow 22s linear infinite;
        }
        .landing-float-a {
          animation: landingFloatA 3.2s ease-in-out infinite alternate;
        }
        .landing-float-b {
          animation: landingFloatB 3.6s ease-in-out infinite alternate;
        }
        .landing-live-pulse {
          animation: landingPulseGlow 1.9s ease-out infinite;
        }
        .landing-ticker-track {
          width: max-content;
          animation: landingTicker 22s linear infinite;
        }
        .landing-star {
          animation: landingTwinkle 2.4s ease-in-out infinite alternate;
        }
      `}</style>

      <header
        className={cn(
          'fixed top-0 z-50 w-full border-b transition-all duration-300',
          isHeaderElevated
            ? 'border-[#2B3D5D] bg-[#0F182A]/88 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-2xl'
            : 'border-[#1A2235] bg-[#111827]/70 backdrop-blur-xl'
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 overflow-hidden rounded-lg border border-[#1A2235] bg-white/5">
              <Image
                src="/brand-logo.png"
                alt="Project logo"
                width={32}
                height={32}
                className="h-8 w-8 object-cover"
                priority
              />
            </div>
            <span className="text-lg font-extrabold tracking-tight text-white">
              Clip<span className="text-gradient-primary">Forge</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm font-medium text-slate-300 transition-colors hover:text-[#00D4FF]"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/login"
              className="rounded-full border border-transparent px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-[#1A2235] hover:bg-[#0B0F1A]"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="bg-gradient-primary shadow-glow-primary shadow-glow-primary-hover rounded-full px-5 py-2 text-sm font-bold text-[#0B0F1A]"
            >
              Get Started Free
            </Link>
          </div>

          <button
            type="button"
            aria-label="Toggle menu"
            className="rounded-lg border border-[#1A2235] p-2 text-slate-200 md:hidden"
            onClick={() => setMobileMenuOpen((value) => !value)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <m.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="border-t border-[#1A2235] bg-[#111827] px-4 py-4 md:hidden"
            >
              <div className="flex flex-col gap-3">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:bg-[#0B0F1A]"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </a>
                ))}
                <div className="mt-2 flex flex-col gap-2">
                  <Link
                    href="/login"
                    className="rounded-full border border-[#1A2235] px-4 py-2 text-center text-sm font-semibold text-slate-100"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/register"
                    className="bg-gradient-primary rounded-full px-4 py-2 text-center text-sm font-semibold text-[#0B0F1A]"
                  >
                    Get Started Free
                  </Link>
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </header>

      <main className="overflow-x-hidden">
        <section className="relative flex min-h-screen items-center justify-center overflow-x-clip px-4 pb-16 pt-28 md:px-8">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="landing-blob-a absolute -left-20 -top-24 h-[40vw] w-[40vw] rounded-full bg-[#7C5CFF] opacity-[0.08] blur-3xl" />
            <div className="landing-blob-b absolute -bottom-20 -right-20 h-[40vw] w-[40vw] rounded-full bg-[#00D4FF] opacity-[0.08] blur-3xl" />
            <div className="landing-grid-overlay absolute inset-0 opacity-70" />
            <div className="landing-aurora absolute left-[-25%] top-[18%] h-44 w-[150%] blur-3xl" />
            {starField.map((star, index) => (
              <span
                key={`${star.top}-${star.left}`}
                className="landing-star absolute rounded-full bg-[#D6E9FF]"
                style={{
                  top: star.top,
                  left: star.left,
                  width: `${star.size}px`,
                  height: `${star.size}px`,
                  animationDelay: `${index * 180}ms`,
                }}
              />
            ))}
          </div>

          <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 lg:grid-cols-[1.06fr_0.94fr]">
            <div className="text-center lg:text-left">
              <m.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.05 }}
                className="inline-flex rounded-full bg-gradient-primary p-[1px] shadow-[0_0_40px_rgba(124,92,255,0.22)]"
              >
                <div className="landing-shimmer rounded-full px-5 py-2 text-[11px] font-semibold tracking-[0.16em] text-[#EAF2FF] md:text-sm">
                  STORY MODE SERIES · MULTI-CHANNEL SCHEDULER · ONE-CLICK YOUTUBE PUBLISHING
                </div>
              </m.div>

              <m.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.15 }}
                className="mt-6 text-5xl font-black leading-tight tracking-tight drop-shadow-[0_16px_34px_rgba(0,0,0,0.45)] md:text-7xl"
              >
                <span className="block">Turn Any Idea Into</span>
                <span className="text-gradient-primary block">Viral YouTube Shorts</span>
                <span className="block">Automatically</span>
              </m.h1>

              <m.p
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.25 }}
                className="mx-auto mt-6 max-w-2xl text-lg text-slate-300 lg:mx-0"
              >
                ClipForge writes scripts, builds narration, assembles cinematic visuals, and uploads directly to your
                channels with no manual editing workflow.
              </m.p>

              <m.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.35 }}
                className="mt-7 flex w-full max-w-xl flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start"
              >
                <Link
                  href="/register"
                  className="bg-gradient-primary shadow-glow-primary shadow-glow-primary-hover w-full rounded-full px-7 py-3 text-center text-base font-bold text-[#0B0F1A] sm:w-auto"
                >
                  Start Generating Free
                </Link>
                <a
                  href="#how-it-works"
                  className="w-full rounded-full border border-[#32507B] bg-[#101A2C]/55 px-7 py-3 text-center text-base font-semibold text-slate-100 transition hover:border-[#7C5CFF] sm:w-auto"
                >
                  See How It Works
                </a>
              </m.div>

              <m.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.45 }}
                className="mt-6 flex flex-col items-center gap-4 text-slate-300 lg:items-start"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-300">Join 10+ creators</span>
                  <div className="flex -space-x-2">
                    {['AK', 'VM', 'RT', 'ML', 'QZ'].map((name, idx) => (
                      <div
                        key={name}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-full border border-[#1A2235] text-[10px] font-bold text-white',
                          idx % 2 === 0 ? 'bg-[#7C5CFF]/60' : 'bg-[#00D4FF]/60'
                        )}
                      >
                        {name}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-amber-300">
                    {Array.from({ length: 5 }).map((_, idx) => (
                      <Star key={idx} className="h-4 w-4 fill-current" />
                    ))}
                  </div>
                </div>
              </m.div>
            </div>

            <div className="relative mx-auto w-full max-w-xl">
              <div className="landing-orbit pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[#2F4770]/60" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-[88%] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#224166]/40" />

              <m.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.55 }}
                className="landing-float-a relative mx-auto w-full rounded-2xl bg-gradient-primary p-[1px] shadow-[0_0_70px_rgba(124,92,255,0.24)]"
              >
                <div className="rounded-2xl border border-[#1A2235] bg-[#111827]/95 p-5 text-left backdrop-blur-xl md:p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-slate-200">
                      <span className="landing-live-pulse h-2.5 w-2.5 rounded-full bg-[#00D4FF]" />
                      Automation Engine Processing
                    </div>
                    <span className="rounded-full border border-[#00D4FF]/30 bg-[#00D4FF]/10 px-3 py-1 text-xs font-semibold text-[#7AE7FF]">
                      Real-Time
                    </span>
                  </div>
                  <p className="mb-4 rounded-lg border border-[#2E466E] bg-[#0B0F1A] p-3 text-sm text-[#E4EEFF]">
                    Build a 45-second short on hidden deep-ocean cities and unexplained sonar signals
                  </p>
                  <div className="mb-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-[#2E466E] bg-[#0E1A30] px-2.5 py-1 text-[11px] font-semibold text-[#9CD9FF]">
                      Voice: Fenrir
                    </span>
                    <span className="rounded-full border border-[#2E466E] bg-[#0E1A30] px-2.5 py-1 text-[11px] font-semibold text-[#E1B8FF]">
                      Mode: Story Part 03
                    </span>
                    <span className="rounded-full border border-[#2E466E] bg-[#0E1A30] px-2.5 py-1 text-[11px] font-semibold text-[#9BFFC9]">
                      Upload: Scheduled
                    </span>
                  </div>
                  <div className="mb-2 h-3 overflow-hidden rounded-full bg-[#0B0F1A]">
                    <m.div
                      className="bg-gradient-primary h-full rounded-full"
                      animate={{ width: `${pipelineProgress}%` }}
                      transition={{ ease: 'linear', duration: 0.12 }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>{displayedStage}</span>
                    <span>{Math.max(0, Math.min(100, Math.round(pipelineProgress)))}%</span>
                  </div>
                </div>
              </m.div>

              <m.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.68 }}
                className="landing-float-b absolute -left-6 top-[22%] hidden w-44 rounded-xl border border-[#2E466E] bg-[#101A2D]/92 p-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.35)] xl:block"
              >
                <div className="mb-2 flex items-center gap-2 text-[#90E2FF]">
                  <Command className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">Queue</span>
                </div>
                <p className="text-lg font-black text-white">18 Ready</p>
                <p className="mt-1 text-[11px] text-slate-300">Across 4 channels</p>
              </m.div>

              <m.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.78 }}
                className="landing-float-a absolute -right-5 bottom-[16%] hidden w-44 rounded-xl border border-[#2E466E] bg-[#101A2D]/92 p-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.35)] xl:block"
              >
                <div className="mb-2 flex items-center gap-2 text-[#E0B8FF]">
                  <Layers className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">Render</span>
                </div>
                <p className="text-lg font-black text-white">06 Active</p>
                <p className="mt-1 text-[11px] text-slate-300">Voice + captions + b-roll</p>
              </m.div>
            </div>
          </div>
        </section>

        <section id="command-center" className="mx-auto max-w-7xl px-4 pb-12 md:px-8">
          <m.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.45 }}
            className="overflow-hidden rounded-3xl border border-[#2A3F63] bg-[#0F182B]/88 shadow-[0_20px_50px_rgba(0,0,0,0.35)]"
          >
            <div className="border-b border-[#2A3F63] bg-[#0D1424] py-2">
              <div className="landing-ticker-track flex items-center gap-3 px-4">
                {[...tickerItems, ...tickerItems].map((item, index) => (
                  <span
                    key={`${item}-${index}`}
                    className="rounded-full border border-[#2A4469] bg-[#101C31] px-3 py-1 text-xs font-semibold text-[#B6D8FF]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3 md:p-7">
              {commandCenterCards.map((card, index) => {
                const Icon = card.icon;
                const isActive = commandCenterIndex === index;
                return (
                  <m.div
                    key={card.title}
                    whileHover={{ y: -5, scale: 1.01 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      'relative overflow-hidden rounded-2xl border p-5',
                      isActive
                        ? 'border-[#4A6FA7] bg-[#13243F] shadow-[0_0_30px_rgba(124,92,255,0.22)]'
                        : 'border-[#223654] bg-[#101A2D]'
                    )}
                  >
                    <div className={cn('absolute inset-0 bg-gradient-to-br opacity-80', card.accent)} />
                    <div className="relative">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="rounded-lg border border-[#365882] bg-[#0E1A30] p-2 text-[#8EDFFF]">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="text-xl font-black text-white">{card.metric}</span>
                      </div>
                      <h3 className="text-lg font-black text-white">{card.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-[#C3D7F7]">{card.description}</p>
                    </div>
                  </m.div>
                );
              })}
            </div>
          </m.div>
        </section>

        <section id="how-it-works" className="relative mx-auto max-w-7xl px-4 py-24 md:px-8">
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute left-[-10%] top-[18%] h-52 w-52 rounded-full bg-[#7C5CFF]/12 blur-3xl" />
            <div className="absolute right-[-10%] bottom-[8%] h-52 w-52 rounded-full bg-[#00D4FF]/12 blur-3xl" />
          </div>
          <m.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="mb-12 text-center text-3xl font-black md:text-5xl"
          >
            From Idea to Upload in <span className="text-gradient-primary">Minutes</span>
          </m.h2>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
            {howItWorksSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <m.div
                  key={step.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.35, delay: index * 0.08 }}
                  whileHover={{ y: -4 }}
                  className="rounded-2xl border border-[#28476F] bg-[#111F35]/75 p-5 shadow-[0_10px_26px_rgba(0,0,0,0.28)]"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <span className="text-gradient-primary text-5xl font-black tracking-tight">0{index + 1}</span>
                    <span className="rounded-lg border border-[#365882] bg-[#0F1B30] p-2">
                      <Icon className="h-4 w-4 text-[#00D4FF]" />
                    </span>
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-white">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-[#C3D7F7]">{step.description}</p>
                </m.div>
              );
            })}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
          <m.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="mb-12 text-center text-3xl font-black md:text-5xl"
          >
            Everything You Need to Dominate Shorts
          </m.h2>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {featureCards.map((feature) => {
              const Icon = feature.icon;
              return (
                <m.div
                  key={feature.title}
                  whileHover={{ y: -4, scale: 1.01 }}
                  transition={{ duration: 0.2 }}
                  className="group relative overflow-hidden rounded-2xl border border-[#28466E] bg-[#101B2E] p-6 transition-colors hover:border-[#7C5CFF]"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-[#7C5CFF]/0 via-[#00D4FF]/0 to-[#FF4FD8]/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div
                      className="rounded-xl border border-[#355986] bg-[#0D1627] p-3"
                      style={{ color: feature.color }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full border border-[#32507A] bg-[#0B1424] px-3 py-1 text-xs font-semibold text-[#B9D8FF]">
                      {feature.tag}
                    </span>
                  </div>
                  <h3 className="relative mb-2 text-xl font-bold text-white">{feature.title}</h3>
                  <p className="relative text-sm leading-relaxed text-[#C5D8F6]">{feature.description}</p>
                </m.div>
              );
            })}
          </div>
        </section>

        <section ref={statsRef} className="my-8 border-y border-[#29446B] bg-[#0F1A2D]/80 py-10">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 md:grid-cols-4 md:px-8">
            {[
              { label: 'Creators' },
              { label: 'Videos Generated' },
              { label: 'Average Rating' },
              { label: 'Uptime' },
            ].map((item, index) => (
              <m.div
                key={item.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.35, delay: index * 0.08 }}
                className="rounded-xl border border-[#2D4B75] bg-[#101C30]/80 px-3 py-4 text-center"
              >
                <div className="text-3xl font-black text-white md:text-4xl">{displayedStats[index]}</div>
                <div className="mt-1 text-sm text-[#BED4F3]">{item.label}</div>
              </m.div>
            ))}
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
          <m.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="mb-4 text-center text-3xl font-black md:text-5xl"
          >
            Simple Pricing, Massive Output
          </m.h2>

          <div className="mt-10 flex gap-5 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
            {planCards.map((plan) => {
              const isPro = plan.highlight === 'pro';
              const isBasic = plan.highlight === 'basic';
              return (
                <m.div
                  key={plan.name}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.2 }}
                  className={cn(
                    'relative min-w-[280px] rounded-2xl border p-6 md:min-w-0',
                    isPro
                      ? 'border-[#7C5CFF] bg-[#121A2B] shadow-[0_0_30px_rgba(124,92,255,0.28)]'
                      : 'border-[#28476F] bg-[#101A2D]'
                  )}
                >
                  {isBasic && (
                    <span className="absolute right-4 top-4 rounded-full border border-[#2E4A74] bg-[#0B1526] px-2.5 py-1 text-[10px] font-bold uppercase text-[#00D4FF]">
                      Most Popular
                    </span>
                  )}
                  {isPro && (
                    <span className="bg-gradient-primary absolute right-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-black uppercase text-[#0B0F1A]">
                      Popular
                    </span>
                  )}
                  <h3 className="text-xl font-black text-white">{plan.name}</h3>
                  <p className={cn('mt-2 text-3xl font-black', isPro ? 'text-gradient-primary' : 'text-white')}>
                    {plan.price}
                  </p>
                  <ul className="mt-5 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-[#C6D9F7]">
                        <Check className="h-4 w-4 text-[#00D4FF]" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/register"
                    className={cn(
                      'mt-6 block rounded-full px-4 py-2.5 text-center text-sm font-bold',
                      isPro
                        ? 'bg-gradient-primary text-[#0B0F1A]'
                        : 'border border-[#1A2235] text-slate-100 transition hover:border-[#7C5CFF]'
                    )}
                  >
                    {plan.cta}
                  </Link>
                </m.div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 md:px-8">
          <m.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="mb-10 text-center text-3xl font-black md:text-5xl"
          >
            Creators Are Scaling Faster With ClipForge
          </m.h2>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {testimonials.map((testimonial, index) => (
              <m.div
                key={testimonial.author}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.35, delay: index * 0.08 }}
                className="rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 shadow-[0_10px_24px_rgba(0,0,0,0.28)]"
              >
                <div className="mb-4 flex items-center gap-1 text-amber-300">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>
                <p className="mb-5 text-sm leading-relaxed text-[#C9DCF8]">"{testimonial.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold', testimonial.avatarBg)}>
                    {testimonial.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{testimonial.author}</p>
                    <p className="text-xs text-slate-400">{testimonial.followers}</p>
                  </div>
                </div>
              </m.div>
            ))}
          </div>
        </section>

        <section id="faq" className="relative mx-auto max-w-5xl px-4 py-16 md:px-8">
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute left-[-20%] top-[10%] h-56 w-56 rounded-full bg-[#7C5CFF]/12 blur-3xl" />
            <div className="absolute right-[-20%] bottom-[8%] h-56 w-56 rounded-full bg-[#00D4FF]/12 blur-3xl" />
          </div>
          <m.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="mb-8 text-center text-3xl font-black text-white drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)] md:text-5xl"
          >
            Frequently Asked Questions
          </m.h2>

          <div className="space-y-4">
            {faqItems.map((faq, index) => {
              const open = openFaqIndex === index;
              return (
                <div
                  key={faq.question}
                  className={cn(
                    'rounded-2xl border bg-[#111827]/95 shadow-[0_10px_24px_rgba(0,0,0,0.34)] backdrop-blur-xl transition-all',
                    open ? 'border-[#335d95] bg-[#121f35]' : 'border-[#223654]'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(open ? null : index)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left md:py-5"
                  >
                    <span className="text-base font-semibold tracking-tight text-[#ECF3FF] md:text-lg">{faq.question}</span>
                    <ChevronDown
                      className={cn(
                        'h-5 w-5 text-[#9DB5DB] transition-transform duration-300',
                        open && 'rotate-180 text-[#00D4FF]'
                      )}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <m.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <p className="border-t border-[#2A4469] bg-[#0D162A]/75 px-5 py-4 text-sm leading-relaxed text-[#CBD9F5] md:text-base">
                          {faq.answer}
                        </p>
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 md:px-8">
          <div className="rounded-3xl border border-[#1A2235] bg-gradient-to-r from-[#111827] via-[#15192a] to-[#111827] px-6 py-12 text-center md:px-10">
            <h2 className="text-3xl font-black md:text-5xl">Start Generating Your First Short Today</h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-slate-400">
              No credit card required. Free forever on the Free plan.
            </p>
            <Link
              href="/register"
              className="bg-gradient-primary shadow-glow-primary shadow-glow-primary-hover mt-7 inline-flex items-center gap-2 rounded-full px-7 py-3 text-base font-black text-[#0B0F1A]"
            >
              Create Your Free Account
              <PlayCircle className="h-4 w-4" />
            </Link>
            <p className="mt-4 text-sm text-slate-400">
              Already have an account?{' '}
              <Link href="/login" className="font-semibold text-[#00D4FF] hover:text-[#7C5CFF]">
                Sign in →
              </Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#1A2235] bg-[#0B0F1A]">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-14 md:grid-cols-2 md:px-8 lg:grid-cols-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-8 w-8 overflow-hidden rounded-lg border border-[#1A2235] bg-white/5">
                <Image
                  src="/brand-logo.png"
                  alt="Project logo"
                  width={32}
                  height={32}
                  className="h-8 w-8 object-cover"
                />
              </div>
              <span className="text-lg font-extrabold text-white">
                Clip<span className="text-gradient-primary">Forge</span>
              </span>
            </div>
            <p className="text-sm text-slate-400">
              AI-native YouTube Shorts automation for creators, agencies, and growth teams.
            </p>
            <div className="mt-4 flex gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-[#1A2235] px-2 py-1">X</span>
              <span className="rounded-full border border-[#1A2235] px-2 py-1">YT</span>
              <span className="rounded-full border border-[#1A2235] px-2 py-1">IG</span>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-200">Product</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link href="/dashboard" className="hover:text-[#00D4FF]">
                  Dashboard
                </Link>
              </li>
              <li>
                <a href="#pricing" className="hover:text-[#00D4FF]">
                  Pricing
                </a>
              </li>
              <li>
                <Link href="/history" className="hover:text-[#00D4FF]">
                  History
                </Link>
              </li>
              <li>
                <Link href="/settings" className="hover:text-[#00D4FF]">
                  Settings
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-200">Support</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link href="/help" className="hover:text-[#00D4FF]">
                  Help Center
                </Link>
              </li>
              <li>
                <a href="#faq" className="hover:text-[#00D4FF]">
                  API Docs
                </a>
              </li>
              <li>
                <a href="/health" className="hover:text-[#00D4FF]">
                  Status
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-200">Legal</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link href="/privacy-policy" className="hover:text-[#00D4FF]">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms-of-service" className="hover:text-[#00D4FF]">
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-[#1A2235]">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-slate-500 md:flex-row md:items-center md:justify-between md:px-8">
            <span>© 2026 ClipForge. All rights reserved.</span>
            <span>Made with AI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
