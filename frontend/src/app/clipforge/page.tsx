import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ClipForge | Official AI Video Automation Tool',
  description:
    'ClipForge is an AI-powered video automation platform that turns long-form content into viral clips with script, narration, visuals, and publishing in one workflow.',
  keywords: [
    'ClipForge',
    'ClipForge app',
    'ClipForge AI',
    'ClipForge video automation',
    'official ClipForge',
    'AI video automation platform',
  ],
  alternates: {
    canonical: '/clipforge',
  },
};

export default function ClipForgePage() {
  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
        <h1 className="text-3xl font-black md:text-5xl">ClipForge - AI Video Automation Platform</h1>

        <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
          ClipForge is an AI-powered platform built for people who want to publish short-form video content quickly and
          consistently. Instead of moving between separate tools for scripting, voice generation, media selection,
          caption styling, and publishing, ClipForge combines the full production workflow in one place. The
          ClipForge app is designed for creators, agencies, and growth teams that need reliable output without adding
          hours of editing work every day. If your goal is to scale content volume while protecting quality, ClipForge
          provides a practical system for that exact problem.
        </p>

        <p className="mt-4 leading-relaxed text-[#C7D9F6] md:text-lg">
          Many teams start with one successful short, then struggle to repeat the same process across multiple ideas,
          channels, or clients. ClipForge addresses this by turning production into a repeatable pipeline. You can use
          ClipForge to define your content direction, generate structured scripts with hooks, apply voice and visuals,
          and queue publishing in advance. Because the process is centralized, every part of your workflow is easier to
          monitor and improve over time. The result is less operational chaos and more consistent publishing cadence.
        </p>

        <section className="mt-8 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
          <h2 className="text-2xl font-bold text-white">How ClipForge Works From Prompt to Published Clip</h2>
          <p className="mt-4 leading-relaxed text-[#BED4F3] md:text-base">
            The core value of ClipForge is workflow compression. You begin with a topic, a source idea, or a content
            angle, and the platform guides the rest of the process with AI-assisted defaults that you can still tune.
            This makes ClipForge useful for both first-time creators and experienced operators who need speed without
            losing editorial control.
          </p>
          <ol className="mt-4 space-y-2 text-sm leading-relaxed text-[#BED4F3] md:text-base">
            <li>1. Enter a prompt or concept and generate a script built for retention and shareability.</li>
            <li>2. Select narration style and let ClipForge map scenes with visuals and timing.</li>
            <li>3. Apply subtitle style and formatting rules to keep every clip brand-consistent.</li>
            <li>4. Export instantly or schedule publishing so your channel stays active around the clock.</li>
          </ol>
          <p className="mt-4 leading-relaxed text-[#BED4F3] md:text-base">
            This end-to-end flow means ClipForge can support single creators who need to ship quickly and larger teams
            that require predictable operations. You spend more time deciding what to publish and less time wrestling
            with repetitive production steps.
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
          <h2 className="text-2xl font-bold text-white">Why ClipForge Helps Teams Scale</h2>
          <p className="mt-4 leading-relaxed text-[#BED4F3] md:text-base">
            Scaling short-form content usually fails because the workflow is fragmented. One person writes scripts,
            another edits, another handles uploads, and the system breaks whenever anyone is busy. ClipForge reduces
            that coordination overhead with a unified production system. Teams can standardize templates, automate
            common decisions, and maintain output quality across channels. As your publishing volume grows, ClipForge
            keeps your process stable by making each step measurable and repeatable. That stability is often the
            difference between a channel that spikes once and a channel that compounds month after month.
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
          <h2 className="text-2xl font-bold text-white">Who Gets The Most Value From ClipForge</h2>
          <p className="mt-4 leading-relaxed text-[#BED4F3] md:text-base">
            ClipForge works well for solo creators who want a sustainable publishing routine, for agencies managing
            multiple client channels, and for in-house teams focused on demand generation through short-form video.
            It is especially useful when consistency matters more than one-off perfection. If your strategy depends on
            publishing often, testing angles quickly, and learning from performance data, ClipForge gives you a strong
            operational base to execute that strategy with less friction.
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
          <h2 className="text-2xl font-bold text-white">Best Practices To Get Better Results</h2>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-[#BED4F3] md:text-base">
            <li>Use clear prompts with audience, tone, and specific outcome so scripts stay focused.</li>
            <li>Batch your topics weekly to keep publishing momentum even on low-energy days.</li>
            <li>Track what hooks hold retention and feed those patterns back into future prompts.</li>
            <li>Keep caption and voice styling consistent so viewers recognize your content instantly.</li>
            <li>Review performance monthly and refine your workflow settings inside the ClipForge app.</li>
          </ul>
          <p className="mt-4 leading-relaxed text-[#BED4F3] md:text-base">
            With disciplined execution, ClipForge becomes more than a generator. It becomes your operating system for
            repeatable short-form growth.
          </p>
        </section>

        <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
          <Link
            href="/clipforge-ai"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            Explore ClipForge AI
          </Link>
          <Link
            href="/clipforge-video-tool"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            ClipForge Video Tool Guide
          </Link>
          <Link
            href="/pricing"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            View Pricing
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-[linear-gradient(to_right,#00D4FF,#7C5CFF)] px-5 py-2.5 text-[#0B0F1A]"
          >
            Start ClipForge Free
          </Link>
        </div>
      </article>
    </main>
  );
}
