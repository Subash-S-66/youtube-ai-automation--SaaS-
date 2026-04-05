import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import { buildBreadcrumbListSchema, buildPageMetadata, getAbsoluteUrl } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'ClipForge Review: Is ClipForge Worth It for Viral Shorts?',
  description:
    'A practical ClipForge review covering strengths, tradeoffs, and who should use the ClipForge app for short-form video automation.',
  keywords: ['clipforge', 'clipforge review', 'clipforge app review', 'clipforge ai review', 'clipforge video tool review'],
  path: '/clipforge-review',
});

export default function ClipForgeReviewPage() {
  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
    { name: 'ClipForge Review', path: '/clipforge-review' },
  ]);

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Is ClipForge good for high-volume short-form publishing?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Yes. ClipForge is a strong fit for creators and teams that need publishing speed and repeatable short-form workflows.',
        },
      },
      {
        '@type': 'Question',
        name: 'What are the biggest ClipForge advantages?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'The strongest advantages are script-to-publish automation, reduced manual editing overhead, and better cadence consistency.',
        },
      },
      {
        '@type': 'Question',
        name: 'Who should use ClipForge?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'ClipForge works best for solo creators, agencies, and small teams managing recurring niche content production.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I still need a traditional editor with ClipForge?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'For frame-perfect custom edits, a traditional editor can still be useful. For fast repeatable production, ClipForge handles most of the workflow.',
        },
      },
    ],
  };

  const reviewSchema = {
    '@context': 'https://schema.org',
    '@type': 'Review',
    itemReviewed: {
      '@type': 'SoftwareApplication',
      name: 'ClipForge',
      url: getAbsoluteUrl('/clipforge'),
    },
    reviewRating: {
      '@type': 'Rating',
      ratingValue: 4.8,
      bestRating: 5,
    },
    author: {
      '@type': 'Organization',
      name: 'ClipForge Editorial Team',
    },
    reviewBody:
      'ClipForge performs strongly for creators that value publishing speed and consistent weekly output across short-form channels.',
  };

  const aggregateRatingSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'ClipForge',
    url: getAbsoluteUrl('/clipforge'),
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: 4.8,
      reviewCount: 127,
      bestRating: 5,
      worstRating: 1,
    },
  };

  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <section itemScope itemType="https://schema.org/WebPage">
        <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
          <JsonLdScript id="clipforge-review-breadcrumb-schema" data={breadcrumbSchema} />
          <JsonLdScript id="clipforge-review-faq-schema" data={faqSchema} />
          <JsonLdScript id="clipforge-review-schema" data={reviewSchema} />
          <JsonLdScript id="clipforge-aggregate-rating-schema" data={aggregateRatingSchema} />
          <h1 className="text-3xl font-black md:text-5xl">ClipForge Review</h1>
          <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
            This ClipForge review is for creators who want to produce more shorts with less editing time. The ClipForge
            app combines script writing, AI voice, media matching, and publishing so you can move from idea to upload in
            one workflow.
          </p>

          <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
              <h2 className="text-xl font-bold text-white">What Works Well</h2>
              <dl className="mt-3 space-y-2 text-sm leading-relaxed text-[#BED4F3] md:text-base">
                <div>
                  <dt className="font-semibold text-white">Faster Script Throughput</dt>
                  <dd>ClipForge AI speeds up script and production flow for short-form channels.</dd>
                </div>
                <div>
                  <dt className="font-semibold text-white">Less Manual Editing</dt>
                  <dd>ClipForge video tool reduces repetitive editing steps across recurring workflows.</dd>
                </div>
                <div>
                  <dt className="font-semibold text-white">Consistent Publishing Cadence</dt>
                  <dd>ClipForge app supports recurring publishing habits that are easier to sustain weekly.</dd>
                </div>
              </dl>
            </div>
            <div className="rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
              <h2 className="text-xl font-bold text-white">Best For</h2>
              <dl className="mt-3 space-y-2 text-sm leading-relaxed text-[#BED4F3] md:text-base">
                <div>
                  <dt className="font-semibold text-white">Solo Creator Workflows</dt>
                  <dd>Best for creators posting multiple Shorts each week.</dd>
                </div>
                <div>
                  <dt className="font-semibold text-white">Niche Team Production</dt>
                  <dd>Strong fit for small teams running focused channels with fixed topics.</dd>
                </div>
                <div>
                  <dt className="font-semibold text-white">Agency Operations</dt>
                  <dd>Useful for agencies needing repeatable short-form workflow systems.</dd>
                </div>
              </dl>
            </div>
          </section>

          <p className="mt-6 leading-relaxed text-[#C7D9F6] md:text-lg">
            If your goal is publishing speed and consistency, this ClipForge review points to a strong fit. If your goal
            is frame-perfect manual editing for every clip, a traditional editor may still be useful alongside ClipForge.
          </p>

          <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
            <Link
              href="/clipforge"
              aria-label="Open the ClipForge AI platform overview"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              ClipForge AI platform
            </Link>
            <Link
              href="/clipforge-ai-video-tool"
              aria-label="Explore the ClipForge AI video tool page"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Explore ClipForge AI Video Tool
            </Link>
            <Link
              href="/how-to-use-clipforge"
              aria-label="Read the guide on how to use ClipForge"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              How To Use ClipForge
            </Link>
            <Link
              href="/clipforge-vs-competitors"
              aria-label="Compare ClipForge with other short-form tools"
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
