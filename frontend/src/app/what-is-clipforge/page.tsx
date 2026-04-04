import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'What Is ClipForge? AI Video Automation Platform Explained',
  description:
    'What is ClipForge? Learn how the ClipForge app and ClipForge AI turn long videos into viral shorts for TikTok, Instagram, and YouTube.',
  keywords: ['clipforge', 'what is clipforge', 'clipforge app', 'clipforge ai', 'clipforge video tool'],
  alternates: {
    canonical: '/what-is-clipforge',
  },
};

export default function WhatIsClipForgePage() {
  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
        <h1 className="text-3xl font-black md:text-5xl">What Is ClipForge?</h1>
        <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
          ClipForge is an AI video automation platform built for creators who want to publish short-form content
          faster. The ClipForge app takes long videos or ideas, turns them into scripts, generates narration, matches
          visuals, and exports ready-to-publish shorts.
        </p>
        <p className="mt-4 leading-relaxed text-[#C7D9F6] md:text-lg">
          ClipForge AI is designed for TikTok, Instagram Reels, and YouTube Shorts workflows. If you need a ClipForge
          video tool that removes repetitive editing work, ClipForge is built for exactly that use case.
        </p>

        <section className="mt-8 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
          <h2 className="text-2xl font-bold text-white">Why Creators Search for ClipForge</h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
            <li>ClipForge app helps publish consistently without manual editing on every video.</li>
            <li>ClipForge AI supports script-first production for high-output content teams.</li>
            <li>ClipForge video tool combines writing, visuals, voice, and scheduling in one workflow.</li>
          </ul>
        </section>

        <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
          <Link
            href="/how-to-use-clipforge"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            How To Use ClipForge
          </Link>
          <Link
            href="/clipforge-review"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            Read ClipForge Review
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
