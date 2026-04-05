import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ClipForge Features | AI Video Automation Capabilities',
  description:
    'Explore ClipForge features for script generation, narration, media matching, captions, scheduling, and multi-channel publishing automation.',
  keywords: [
    'ClipForge features',
    'ClipForge',
    'ClipForge app',
    'ClipForge AI capabilities',
    'video automation features',
  ],
  alternates: {
    canonical: '/features',
  },
};

const featureGroups = [
  {
    title: 'AI Script and Content Engine',
    points: [
      'Hook-first script drafts optimized for retention and short-form pacing.',
      'Prompt-driven generation for niche topics, explainers, stories, and list formats.',
      'Reusable content templates for consistent output across creators or teams.',
    ],
  },
  {
    title: 'Voice, Visual, and Caption Pipeline',
    points: [
      'AI narration workflow with multiple voice styles for different channel tones.',
      'Automatic visual matching and sequencing to support script structure.',
      'Caption styling controls for font, placement, and readability consistency.',
    ],
  },
  {
    title: 'Publishing and Scale Operations',
    points: [
      'Queue management for batching and scheduling uploads in advance.',
      'Multi-channel workflow for creators, agencies, and in-house growth teams.',
      'Operational consistency that reduces manual editing bottlenecks over time.',
    ],
  },
];

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
        <h1 className="text-3xl font-black md:text-5xl">ClipForge Features</h1>
        <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
          ClipForge combines script generation, production automation, and publishing controls in one platform.
          Instead of managing disconnected tools, ClipForge helps you run a repeatable short-form content workflow from
          idea to uploaded clip.
        </p>

        <div className="mt-8 space-y-4">
          {featureGroups.map((group) => (
            <section key={group.title} className="rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
              <h2 className="text-2xl font-bold text-white">{group.title}</h2>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-[#BED4F3] md:text-base">
                {group.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-8 leading-relaxed text-[#C7D9F6] md:text-lg">
          If you are evaluating ClipForge for your workflow, start with a small weekly publishing plan, measure
          performance, and then expand output based on what your audience responds to most.
        </p>

        <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
          <Link
            href="/clipforge"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            ClipForge Overview
          </Link>
          <Link
            href="/clipforge-ai"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            ClipForge AI
          </Link>
          <Link
            href="/pricing"
            className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
          >
            Pricing
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-[linear-gradient(to_right,#00D4FF,#7C5CFF)] px-5 py-2.5 text-[#0B0F1A]"
          >
            Start Free
          </Link>
        </div>
      </article>
    </main>
  );
}
