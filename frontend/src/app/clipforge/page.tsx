import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import { buildBreadcrumbListSchema, buildPageMetadata, getAbsoluteUrl } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
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
  path: '/clipforge',
});

export default function ClipForgePage() {
  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
    { name: 'ClipForge', path: '/clipforge' },
  ]);

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is ClipForge used for?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'ClipForge is used to turn topic prompts or long-form content into short-form videos with script generation, narration, media matching, captions, and publishing workflow in one platform.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is ClipForge good for teams and agencies?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Yes. ClipForge supports repeatable workflows, template consistency, and queue-based publishing that helps agencies and in-house teams scale short-form output.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does ClipForge include captions and voice support?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Yes. ClipForge includes narration controls and subtitle styling so teams can keep readability and branding consistent across videos.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I schedule publishing with ClipForge?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Yes. ClipForge supports queueing and scheduled publishing so channels can maintain a consistent posting cadence with less manual work.',
        },
      },
    ],
  };

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'ClipForge',
    image: getAbsoluteUrl('/brand-logo.png'),
    description:
      'ClipForge is an AI-powered video automation platform that turns long-form content into viral short clips.',
    brand: {
      '@type': 'Brand',
      name: 'ClipForge',
    },
    category: 'AI Video Automation Software',
    offers: {
      '@type': 'Offer',
      url: getAbsoluteUrl('/price'),
      priceCurrency: 'USD',
      price: '10',
      availability: 'https://schema.org/InStock',
    },
  };

  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <section itemScope itemType="https://schema.org/WebPage">
        <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
          <JsonLdScript id="clipforge-breadcrumb-schema" data={breadcrumbSchema} />
          <JsonLdScript id="clipforge-faq-schema" data={faqSchema} />
          <JsonLdScript id="clipforge-product-schema" data={productSchema} />
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
            <dl className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              <div>
                <dt className="font-semibold text-white">Prompt and Script Generation</dt>
                <dd>Enter a topic or concept and generate a script built for retention and shareability.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Narration and Scene Alignment</dt>
                <dd>Select narration style and let ClipForge map scenes with visuals and timing.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Caption Consistency</dt>
                <dd>Apply subtitle style and formatting rules to keep every clip brand-consistent.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Export or Scheduled Publishing</dt>
                <dd>Export instantly or schedule publishing so your channel stays active around the clock.</dd>
              </div>
            </dl>
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
            <dl className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              <div>
                <dt className="font-semibold text-white">Prompt Clarity</dt>
                <dd>Use clear prompts with audience, tone, and specific outcome so scripts stay focused.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Weekly Topic Batching</dt>
                <dd>Batch your topics weekly to keep publishing momentum even on low-energy days.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Retention Feedback Loop</dt>
                <dd>Track what hooks hold retention and feed those patterns back into future prompts.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Visual and Caption Consistency</dt>
                <dd>Keep caption and voice styling consistent so viewers recognize your content instantly.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Monthly Optimization Cycle</dt>
                <dd>Review performance monthly and refine workflow settings inside the ClipForge app.</dd>
              </div>
            </dl>
            <p className="mt-4 leading-relaxed text-[#BED4F3] md:text-base">
              With disciplined execution, ClipForge becomes more than a generator. It becomes your operating system for
              repeatable short-form growth.
            </p>
          </section>

          <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row">
            <Link
              href="/clipforge-ai"
              aria-label="Read the ClipForge AI page"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Explore ClipForge AI
            </Link>
            <Link
              href="/clipforge-video-tool"
              aria-label="Open the ClipForge video tool guide"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              ClipForge Video Tool Guide
            </Link>
            <Link
              href="/clipforge-vs-competitors"
              aria-label="Compare ClipForge with other AI video tools"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Compare ClipForge
            </Link>
            <Link
              href="/price"
              aria-label="Review ClipForge pricing plans"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              View Pricing
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
