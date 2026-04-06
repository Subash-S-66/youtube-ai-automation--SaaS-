import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import { buildBreadcrumbListSchema, buildPageMetadata, getAbsoluteUrl } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'ClipForge Price | Plans for AI Video Automation',
  description:
    'View ClipForge price options for creators and teams. Start free, scale with paid tiers, and unlock higher automation limits as your content volume grows.',
  keywords: [
    'clipforge price',
    'clipforge plans',
    'clipforge pricing',
    'clipforge subscription',
    'ai video automation pricing',
  ],
  path: '/price',
});

export default function PricePage() {
  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
    { name: 'Price', path: '/price' },
  ]);

  const offerSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'ClipForge',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
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
          <JsonLdScript id="price-breadcrumb-schema" data={breadcrumbSchema} />
          <JsonLdScript id="price-offer-schema" data={offerSchema} />

          <h1 className="text-3xl font-black md:text-5xl">ClipForge Price and Plans</h1>
          <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
            ClipForge is built to support both early-stage creators and high-output teams. You can start with a low-risk
            plan and scale as your publishing volume grows. Paid tiers unlock stronger daily limits, more channels,
            advanced automation controls, and faster production throughput.
          </p>

          <section className="mt-8 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
            <h2 className="text-2xl font-bold text-white">Plan Snapshot</h2>
            <dl className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              <div>
                <dt className="font-semibold text-white">Free</dt>
                <dd>Start with core workflow access and baseline usage limits.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Basic (From $10/month)</dt>
                <dd>Increase your daily output with paid automation limits and production controls.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Pro</dt>
                <dd>Scale to higher clip volume and unlock deeper creator workflow features.</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Premium</dt>
                <dd>Built for teams and agencies that need broader capacity and operational consistency.</dd>
              </div>
            </dl>
          </section>

          <section className="mt-6 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
            <h2 className="text-2xl font-bold text-white">What Changes As You Upgrade</h2>
            <p className="mt-4 leading-relaxed text-[#BED4F3] md:text-base">
              Higher tiers are designed for output scale. As you move up, you typically unlock more daily uploads,
              larger channel capacity, richer media controls, and stronger workflow options for scheduling and reuse.
            </p>
            <p className="mt-4 leading-relaxed text-[#BED4F3] md:text-base">
              Exact plan limits and active discount offers are always available in your in-app billing view.
            </p>
          </section>

          <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row md:flex-wrap">
            <Link
              href="/register"
              aria-label="Start ClipForge for free"
              className="rounded-full bg-[linear-gradient(to_right,#00D4FF,#7C5CFF)] px-5 py-2.5 text-[#0B0F1A]"
            >
              Start Free
            </Link>
            <Link
              href="/pricing"
              aria-label="Open in-app pricing and billing page"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Open In-App Pricing
            </Link>
            <Link
              href="/features"
              aria-label="Explore ClipForge features"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Explore Features
            </Link>
          </div>
        </article>
      </section>
      <SiteNavigation />
    </main>
  );
}
