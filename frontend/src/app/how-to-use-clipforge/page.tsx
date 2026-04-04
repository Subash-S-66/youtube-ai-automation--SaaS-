import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How To Use ClipForge: Step-by-Step Guide',
  description:
    'Learn how to use ClipForge from setup to publishing. Follow this guide to run the ClipForge app and ClipForge AI workflow effectively.',
  keywords: ['clipforge', 'how to use clipforge', 'clipforge app tutorial', 'clipforge ai guide', 'clipforge video tool setup'],
  alternates: {
    canonical: '/how-to-use-clipforge',
  },
};

export default function HowToUseClipForgePage() {
  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
        <h1 className="text-3xl font-black md:text-5xl">How To Use ClipForge</h1>
        <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
          This guide shows how to use the ClipForge app from account setup to automated publishing. If you are new to
          ClipForge AI, these steps will help you get your first short live quickly.
        </p>

        <section className="mt-8 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
          <h2 className="text-2xl font-bold text-white">Step-by-Step</h2>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
            <li>1. Create your account and connect your publishing channel.</li>
            <li>2. Enter a topic or source material in the ClipForge app dashboard.</li>
            <li>3. Generate script options using ClipForge AI and select your preferred style.</li>
            <li>4. Choose voice, media behavior, caption style, and upload settings.</li>
            <li>5. Publish instantly or schedule from the ClipForge video tool queue.</li>
          </ol>
        </section>

        <section className="mt-6 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
          <h2 className="text-2xl font-bold text-white">Tips for Better Results</h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
            <li>Use specific prompts with audience, topic angle, and desired video length.</li>
            <li>Batch-generate content weekly to keep your posting cadence consistent.</li>
            <li>Review output and update your prompt templates based on performance.</li>
          </ul>
        </section>

        <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
          <Link
            href="/what-is-clipforge"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            What Is ClipForge
          </Link>
          <Link
            href="/clipforge-review"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            ClipForge Review
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-[linear-gradient(to_right,#00D4FF,#7C5CFF)] px-5 py-2.5 text-[#0B0F1A]"
          >
            Launch ClipForge App
          </Link>
        </div>
      </article>
    </main>
  );
}
