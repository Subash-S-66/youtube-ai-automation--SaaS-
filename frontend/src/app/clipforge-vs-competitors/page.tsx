import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import { buildBreadcrumbListSchema, buildPageMetadata } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'ClipForge vs Competitors | Best AI Video Tool 2025 Comparison',
  description:
    'Compare ClipForge vs alternative short-form tools including generic competitor platforms. See why ClipForge leads in automation depth and publishing support.',
  keywords: [
    'clipforge vs opus clip',
    'clipforge vs vidyo',
    'best ai video tool 2025',
    'clipforge alternative',
  ],
  path: '/clipforge-vs-competitors',
});

const comparisonRows = [
  {
    metric: 'Pricing Value',
    clipforge: 'Transparent plans with strong output-to-cost ratio',
    competitorA: 'Higher tiers needed for practical output scale',
    competitorB: 'Feature paywalls increase total cost quickly',
  },
  {
    metric: 'Automation Depth',
    clipforge: 'Prompt to script, voice, visuals, captions, and queue in one workflow',
    competitorA: 'Strong clipping tools but less end-to-end automation',
    competitorB: 'Partial automation, requires more manual pipeline steps',
  },
  {
    metric: 'Publishing Support',
    clipforge: 'Built-in scheduling and publishing-ready workflow',
    competitorA: 'Limited publish automation beyond export',
    competitorB: 'Primarily export-focused without deep scheduling controls',
  },
  {
    metric: 'Ease of Use',
    clipforge: 'Single workflow designed for repeatable weekly publishing',
    competitorA: 'Learning curve rises when scaling channel operations',
    competitorB: 'Requires more tool-switching for full production flow',
  },
];

export default function ClipForgeVsCompetitorsPage() {
  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
    { name: 'ClipForge vs Competitors', path: '/clipforge-vs-competitors' },
  ]);

  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <section itemScope itemType="https://schema.org/WebPage">
        <article className="mx-auto max-w-5xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
          <JsonLdScript id="clipforge-vs-competitors-breadcrumb-schema" data={breadcrumbSchema} />
          <h1 className="text-3xl font-black md:text-5xl">ClipForge vs Competitors</h1>

          <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
            This comparison looks at how ClipForge stacks up against two common AI video tool alternatives. If you are
            searching for the best AI video tool in 2025, the key difference is workflow depth. ClipForge focuses on
            full production automation instead of isolated feature wins.
          </p>

          <div className="mt-8 overflow-x-auto rounded-xl border border-[#32507A] bg-[#0F1A2D]">
            <table className="w-full min-w-180 border-collapse text-left text-sm text-[#BED4F3] md:text-base">
              <caption className="sr-only">ClipForge competitor comparison table</caption>
              <thead className="bg-[#13203A] text-white">
                <tr>
                  <th scope="col" className="px-4 py-3 font-bold">Comparison Area</th>
                  <th scope="col" className="px-4 py-3 font-bold">ClipForge</th>
                  <th scope="col" className="px-4 py-3 font-bold">Competitor A</th>
                  <th scope="col" className="px-4 py-3 font-bold">Competitor B</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.metric} className="border-t border-[#2D4468] align-top">
                    <th scope="row" className="px-4 py-4 font-semibold text-white">{row.metric}</th>
                    <td className="px-4 py-4 text-green-300">{row.clipforge}</td>
                    <td className="px-4 py-4">{row.competitorA}</td>
                    <td className="px-4 py-4">{row.competitorB}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 leading-relaxed text-[#C7D9F6] md:text-lg">
            For creators and teams that need predictable publishing velocity, ClipForge wins because it merges script,
            production, and scheduling into one repeatable system. That removes operational drag and supports stronger
            weekly consistency than toolchains that rely on multiple disconnected apps.
          </p>

          <div className="mt-8 flex flex-col gap-3 text-sm font-semibold md:flex-row md:flex-wrap">
            <Link
              href="/clipforge"
              aria-label="Read ClipForge overview"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              ClipForge overview
            </Link>
            <Link
              href="/features"
              aria-label="Explore ClipForge feature breakdown"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Explore Features
            </Link>
            <Link
              href="/clipforge-review"
              aria-label="Read full ClipForge review"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Read ClipForge Review
            </Link>
            <Link
              href="/price"
              aria-label="View ClipForge pricing plans"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              View Pricing
            </Link>
            <Link
              href="/register"
              aria-label="Start ClipForge free account"
              className="rounded-full bg-[linear-gradient(to_right,#00D4FF,#7C5CFF)] px-5 py-2.5 text-[#F5FAFF] shadow-[0_1px_2px_rgba(11,15,26,0.72)]"
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
