import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import { buildBreadcrumbListSchema, buildPageMetadata, getAbsoluteUrl } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'How To Use ClipForge: Step-by-Step Guide',
  description:
    'Learn how to use ClipForge from setup to publishing. Follow this guide to run the ClipForge app and ClipForge AI workflow effectively.',
  keywords: ['clipforge', 'how to use clipforge', 'clipforge app tutorial', 'clipforge ai guide', 'clipforge video tool setup'],
  path: '/how-to-use-clipforge',
});

export default function HowToUseClipForgePage() {
  const stepList = [
    'Create your account and connect your publishing channel.',
    'Enter a topic or source material in the ClipForge app dashboard.',
    'Generate script options using ClipForge AI and select your preferred style.',
    'Choose voice, media behavior, caption style, and upload settings.',
    'Publish instantly or schedule from the ClipForge video tool queue.',
  ];

  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
    { name: 'How To Use ClipForge', path: '/how-to-use-clipforge' },
  ]);

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'How do I get started with ClipForge?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Start by creating an account, connecting your channel, and entering a topic in the dashboard to generate your first script.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I schedule videos in ClipForge?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Yes. ClipForge supports immediate publishing and queue-based scheduling so your content can post automatically.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need editing software after ClipForge?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Most users can publish directly from ClipForge, but advanced creators can still export and fine-tune externally if needed.',
        },
      },
      {
        '@type': 'Question',
        name: 'How can I improve ClipForge output quality?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Use specific prompts, batch weekly topics, and iterate your prompt templates using performance insights from recent videos.',
        },
      },
    ],
  };

  const howToSchema = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How To Use ClipForge',
    description:
      'Step-by-step process to run ClipForge from setup to short-form video publishing.',
    image: getAbsoluteUrl('/brand-logo.png'),
    totalTime: 'PT20M',
    supply: [
      {
        '@type': 'HowToSupply',
        name: 'ClipForge account',
      },
      {
        '@type': 'HowToSupply',
        name: 'Connected publishing channel',
      },
    ],
    step: stepList.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: `Step ${index + 1}`,
      text: step,
      url: getAbsoluteUrl('/how-to-use-clipforge'),
    })),
  };

  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <section itemScope itemType="https://schema.org/WebPage">
        <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
          <JsonLdScript id="how-to-use-clipforge-breadcrumb-schema" data={breadcrumbSchema} />
          <JsonLdScript id="how-to-use-clipforge-faq-schema" data={faqSchema} />
          <JsonLdScript id="how-to-use-clipforge-howto-schema" data={howToSchema} />
          <h1 className="text-3xl font-black md:text-5xl">How To Use ClipForge</h1>
          <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
            This guide shows how to use the ClipForge app from account setup to automated publishing. If you are new to
            ClipForge AI, these steps will help you get your first short live quickly.
          </p>

          <section className="mt-8 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
            <h2 className="text-2xl font-bold text-white">Step-by-Step</h2>
            <ol className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              {stepList.map((step, index) => (
                <li key={step}>{index + 1}. {step}</li>
              ))}
            </ol>
          </section>

          <section className="mt-6 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
            <h2 className="text-2xl font-bold text-white">Tips for Better Results</h2>
            <dl className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              <div>
                <dt className="font-semibold text-white">Prompt Precision</dt>
                <dd>Use specific prompts with audience, topic angle, and desired video length.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Weekly Batch Planning</dt>
                <dd>Batch-generate content weekly to keep your posting cadence consistent.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Template Iteration</dt>
                <dd>Review output and update your prompt templates based on performance.</dd>
              </div>
            </dl>
          </section>

          <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
            <Link
              href="/clipforge"
              aria-label="Read ClipForge overview"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              ClipForge overview
            </Link>
            <Link
              href="/what-is-clipforge"
              aria-label="Read what ClipForge is"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              What Is ClipForge
            </Link>
            <Link
              href="/clipforge-review"
              aria-label="Read ClipForge review"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              ClipForge Review
            </Link>
            <Link
              href="/clipforge-vs-competitors"
              aria-label="See ClipForge competitor comparison"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Compare ClipForge
            </Link>
            <Link
              href="/register"
              aria-label="Launch ClipForge app"
              className="rounded-full bg-[linear-gradient(to_right,#00D4FF,#7C5CFF)] px-5 py-2.5 text-[#F5FAFF] shadow-[0_1px_2px_rgba(11,15,26,0.72)]"
            >
              Launch ClipForge App
            </Link>
          </div>
        </article>
      </section>
      <SiteNavigation />
    </main>
  );
}
