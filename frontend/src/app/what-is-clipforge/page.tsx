import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import { buildBreadcrumbListSchema, buildPageMetadata } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'What Is ClipForge? AI Video Automation Platform Explained',
  description:
    'What is ClipForge? Learn how the ClipForge app and ClipForge AI turn long videos into viral shorts for TikTok, Instagram, and YouTube.',
  keywords: ['clipforge', 'what is clipforge', 'clipforge app', 'clipforge ai', 'clipforge video tool'],
  path: '/what-is-clipforge',
});

export default function WhatIsClipForgePage() {
  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
    { name: 'What Is ClipForge', path: '/what-is-clipforge' },
  ]);

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is ClipForge?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'ClipForge is an AI video automation platform that converts ideas or long-form videos into short-form content with script, voice, visuals, captions, and publishing workflow.',
        },
      },
      {
        '@type': 'Question',
        name: 'What does ClipForge AI do?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'ClipForge AI generates script structure, supports narration flow, and helps align visuals and captions so creators can publish faster with consistent quality.',
        },
      },
      {
        '@type': 'Question',
        name: 'Who should use the ClipForge app?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'ClipForge is suitable for solo creators, agencies, and in-house teams that need repeatable short-form publishing workflows across TikTok, Instagram, and YouTube.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is ClipForge only a script writer?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'No. ClipForge supports a complete workflow from scripting to visuals, captions, and publish-ready output, not just standalone script generation.',
        },
      },
    ],
  };

  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <section itemScope itemType="https://schema.org/WebPage">
        <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
          <JsonLdScript id="what-is-clipforge-breadcrumb-schema" data={breadcrumbSchema} />
          <JsonLdScript id="what-is-clipforge-faq-schema" data={faqSchema} />
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
            <dl className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              <div>
                <dt className="font-semibold text-white">Consistent Publishing Output</dt>
                <dd>ClipForge app helps publish consistently without manual editing on every video.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Script-First AI Workflow</dt>
                <dd>ClipForge AI supports script-first production for high-output content teams.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Unified Production Stack</dt>
                <dd>ClipForge video tool combines writing, visuals, voice, and scheduling in one workflow.</dd>
              </div>
            </dl>
          </section>

          <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
            <Link
              href="/clipforge"
              aria-label="Open the ClipForge overview page"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              ClipForge overview
            </Link>
            <Link
              href="/how-to-use-clipforge"
              aria-label="Read the guide for how to use ClipForge"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              How To Use ClipForge
            </Link>
            <Link
              href="/clipforge-review"
              aria-label="Read the ClipForge review page"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Read ClipForge Review
            </Link>
            <Link
              href="/clipforge-vs-competitors"
              aria-label="Compare ClipForge against competitors"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Compare ClipForge
            </Link>
            <Link
              href="/register"
              aria-label="Start ClipForge Free"
              className="rounded-full bg-[linear-gradient(to_right,#00D4FF,#7C5CFF)] px-5 py-2.5 text-[#0B0F1A]"
            >
              Start ClipForge Free
            </Link>
          </div>
        </article>
      </section>
      <SiteNavigation />
    </main>
  );
}
