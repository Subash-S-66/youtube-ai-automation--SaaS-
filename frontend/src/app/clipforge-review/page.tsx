import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ClipForge Review: Is ClipForge Worth It for Viral Shorts?',
  description:
    'A practical ClipForge review covering strengths, tradeoffs, and who should use the ClipForge app for short-form video automation.',
  keywords: ['clipforge', 'clipforge review', 'clipforge app review', 'clipforge ai review', 'clipforge video tool review'],
  alternates: {
    canonical: '/clipforge-review',
  },
};

export default function ClipForgeReviewPage() {
  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
        <h1 className="text-3xl font-black md:text-5xl">ClipForge Review</h1>
        <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
          This ClipForge review is for creators who want to produce more shorts with less editing time. The ClipForge
          app combines script writing, AI voice, media matching, and publishing so you can move from idea to upload in
          one workflow.
        </p>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
            <h2 className="text-xl font-bold text-white">What Works Well</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              <li>ClipForge AI speeds up script and production flow.</li>
              <li>ClipForge video tool reduces manual editing steps.</li>
              <li>ClipForge app supports recurring publishing habits.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
            <h2 className="text-xl font-bold text-white">Best For</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              <li>Solo creators posting multiple shorts per week.</li>
              <li>Small teams running niche channels with fixed topics.</li>
              <li>Agencies needing repeatable short-form workflows.</li>
            </ul>
          </div>
        </section>

        <p className="mt-6 leading-relaxed text-[#C7D9F6] md:text-lg">
          If your goal is publishing speed and consistency, this ClipForge review points to a strong fit. If your goal
          is frame-perfect manual editing for every clip, a traditional editor may still be useful alongside ClipForge.
        </p>

        <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
          <Link
            href="/clipforge-ai-video-tool"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            Explore ClipForge AI Video Tool
          </Link>
          <Link
            href="/how-to-use-clipforge"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            How To Use ClipForge
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
