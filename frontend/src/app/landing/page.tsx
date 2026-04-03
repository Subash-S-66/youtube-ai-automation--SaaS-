'use client';

import Link from 'next/link';
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

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'How It Works', href: '#how-it-works' },
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
  'Generating AI Script...',
  'Fetching Stock Media...',
  'Mixing Audio...',
  'Uploading to YouTube...',
  'Complete ✓',
];

const statTargets = [2000, 150000, 49, 992];

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [pipelineStageIndex, setPipelineStageIndex] = useState(0);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [statsStarted, setStatsStarted] = useState(false);
  const [statValues, setStatValues] = useState([0, 0, 0, 0]);
  const statsRef = useRef<HTMLDivElement | null>(null);

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
    <div className="min-h-screen bg-[#0B0F1A] text-[#F8FAFC]">
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
        .landing-blob-a {
          animation: landingBlobDriftA 20s ease-in-out infinite alternate;
        }
        .landing-blob-b {
          animation: landingBlobDriftB 20s ease-in-out infinite alternate;
        }
      `}</style>

      <header className="fixed top-0 z-50 w-full border-b border-[#1A2235] bg-[#111827]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#7C5CFF]" />
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
        <section className="relative flex min-h-screen items-center justify-center px-4 pb-16 pt-28 md:px-8">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="landing-blob-a absolute -left-20 -top-24 h-[40vw] w-[40vw] rounded-full bg-[#7C5CFF] opacity-[0.05] blur-3xl" />
            <div className="landing-blob-b absolute -bottom-20 -right-20 h-[40vw] w-[40vw] rounded-full bg-[#00D4FF] opacity-[0.05] blur-3xl" />
          </div>

          <div className="relative mx-auto flex w-full max-w-7xl flex-col items-center gap-10 text-center">
            <m.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.05 }}
              className="inline-flex rounded-full bg-gradient-primary p-[1px]"
            >
              <div className="rounded-full bg-[#111827]/80 px-4 py-1.5 text-xs font-semibold tracking-wide text-slate-100 md:text-sm">
                🤖 AI-Powered · Auto-Upload · Fully Automated
              </div>
            </m.div>

            <m.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.15 }}
              className="text-5xl font-black leading-tight tracking-tight md:text-7xl"
            >
              <span className="block">Turn Any Idea Into</span>
              <span className="text-gradient-primary block">Viral YouTube Shorts</span>
              <span className="block">Automatically</span>
            </m.h1>

            <m.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.25 }}
              className="mx-auto max-w-2xl text-lg text-slate-400"
            >
              ClipForge generates scripts with AI, adds narration in 5 premium voices, assembles cinematic visuals,
              and uploads directly to your YouTube channel — all without touching a single video editor.
            </m.p>

            <m.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.35 }}
              className="flex w-full max-w-xl flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Link
                href="/register"
                className="bg-gradient-primary shadow-glow-primary shadow-glow-primary-hover w-full rounded-full px-7 py-3 text-center text-base font-bold text-[#0B0F1A] sm:w-auto"
              >
                Start Generating Free
              </Link>
              <a
                href="#how-it-works"
                className="w-full rounded-full border border-[#1A2235] px-7 py-3 text-center text-base font-semibold text-slate-100 transition hover:border-[#7C5CFF] sm:w-auto"
              >
                See How It Works
              </a>
            </m.div>

            <m.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.45 }}
              className="flex flex-col items-center gap-4 text-slate-300"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-300">Join 2,000+ creators</span>
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

            <m.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.55 }}
              className="mx-auto mt-2 w-full max-w-3xl rounded-2xl bg-gradient-primary p-[1px]"
            >
              <div className="rounded-2xl border border-[#1A2235] bg-[#111827] p-5 text-left md:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <CircleDashed className="h-4 w-4 animate-spin text-[#00D4FF]" />
                    Pipeline Running
                  </div>
                  <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
                    Live
                  </span>
                </div>
                <p className="mb-4 rounded-lg border border-[#1A2235] bg-[#0B0F1A] p-3 text-sm text-slate-200">
                  Space exploration secrets no one talks about
                </p>
                <div className="mb-2 h-3 overflow-hidden rounded-full bg-[#0B0F1A]">
                  <m.div
                    className="bg-gradient-primary h-full rounded-full"
                    animate={{ width: `${pipelineProgress}%` }}
                    transition={{ ease: 'linear', duration: 0.12 }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{displayedStage}</span>
                  <span>{Math.max(0, Math.min(100, Math.round(pipelineProgress)))}%</span>
                </div>
              </div>
            </m.div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-20 md:px-8">
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
                  className="rounded-2xl border border-[#1A2235] bg-[#111827]/60 p-5"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <span className="text-gradient-primary text-4xl font-black">0{index + 1}</span>
                    <Icon className="h-5 w-5 text-[#00D4FF]" />
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-white">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{step.description}</p>
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
                  className="rounded-2xl border border-[#1A2235] bg-[#111827] p-6 transition-colors hover:border-[#7C5CFF]"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div
                      className="rounded-xl border border-[#1A2235] p-3"
                      style={{ color: feature.color }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full border border-[#1A2235] bg-[#0B0F1A] px-3 py-1 text-xs font-semibold text-slate-300">
                      {feature.tag}
                    </span>
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-white">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{feature.description}</p>
                </m.div>
              );
            })}
          </div>
        </section>

        <section ref={statsRef} className="my-8 border-y border-[#1A2235] bg-[#111827]/60 py-10">
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
                className="text-center"
              >
                <div className="text-3xl font-black text-white md:text-4xl">{displayedStats[index]}</div>
                <div className="mt-1 text-sm text-slate-400">{item.label}</div>
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
                    'relative min-w-[280px] rounded-2xl border bg-[#111827] p-6 md:min-w-0',
                    isPro ? 'border-[#7C5CFF] shadow-glow-primary' : 'border-[#1A2235]'
                  )}
                >
                  {isBasic && (
                    <span className="absolute right-4 top-4 rounded-full border border-[#1A2235] bg-[#0B0F1A] px-2.5 py-1 text-[10px] font-bold uppercase text-[#00D4FF]">
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
                      <li key={feature} className="flex items-center gap-2 text-sm text-slate-300">
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
                className="rounded-2xl border border-[#1A2235] bg-[#111827] p-6"
              >
                <div className="mb-4 flex items-center gap-1 text-amber-300">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>
                <p className="mb-5 text-sm leading-relaxed text-slate-300">"{testimonial.quote}"</p>
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

        <section id="faq" className="mx-auto max-w-5xl px-4 py-16 md:px-8">
          <m.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="mb-8 text-center text-3xl font-black md:text-5xl"
          >
            Frequently Asked Questions
          </m.h2>

          <div className="space-y-3">
            {faqItems.map((faq, index) => {
              const open = openFaqIndex === index;
              return (
                <div key={faq.question} className="rounded-xl border border-[#1A2235] bg-[#111827]">
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(open ? null : index)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-sm font-semibold text-white md:text-base">{faq.question}</span>
                    <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')} />
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
                        <p className="border-t border-[#1A2235] px-5 py-4 text-sm leading-relaxed text-slate-400">{faq.answer}</p>
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
              <Sparkles className="h-5 w-5 text-[#7C5CFF]" />
              <span className="text-lg font-extrabold">
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
            <span>© 2025 ClipForge. All rights reserved.</span>
            <span>Made with AI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

