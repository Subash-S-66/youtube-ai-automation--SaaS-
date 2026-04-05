import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import { buildBreadcrumbListSchema, buildPageMetadata } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'ClipForge AI Video Tool: Features and Workflow',
  description:
    'See how the ClipForge AI video tool works from script generation to auto publishing for TikTok, Instagram, and YouTube Shorts.',
  keywords: [
    'clipforge',
    'clipforge ai video tool',
    'clipforge app features',
    'clipforge ai workflow',
    'video automation tool',
  ],
  path: '/clipforge-ai-video-tool',
});

export default function ClipForgeAiVideoToolPage() {
  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
    { name: 'ClipForge AI Video Tool', path: '/clipforge-ai-video-tool' },
  ]);

  return (
    <main className="min-h-screen bg-[#0B0F1A] px-4 py-16 text-[#EAF2FF] md:px-8">
      <section itemScope itemType="https://schema.org/WebPage">
        <article className="mx-auto max-w-4xl rounded-2xl border border-[#28476F] bg-[#101A2D] p-6 md:p-10">
          <JsonLdScript id="clipforge-ai-video-tool-breadcrumb-schema" data={breadcrumbSchema} />
          <h1 className="text-3xl font-black md:text-5xl">ClipForge AI Video Tool</h1>
          <p className="mt-5 leading-relaxed text-[#C7D9F6] md:text-lg">
            The ClipForge video tool is built for speed: prompt, script, voice, visuals, captions, and publishing from
            one dashboard. Instead of handling multiple apps, the ClipForge app keeps your entire short-form pipeline in
            one place.
          </p>
          <p className="mt-4 leading-relaxed text-[#C7D9F6] md:text-lg">
            ClipForge AI is optimized for creators who want volume and consistency. Teams can run recurring content
            schedules and automate publishing to channels without re-editing every clip manually.
          </p>

          <section className="mt-8 rounded-xl border border-[#32507A] bg-[#0F1A2D] p-5">
            <h2 className="text-2xl font-bold text-white">Core Workflow</h2>
            <ol className="mt-4 space-y-3 text-sm leading-relaxed text-[#BED4F3] md:text-base">
              <li>1. Enter a topic or long-form source video in the ClipForge app.</li>
              <li>2. Let ClipForge AI generate hook-first short script options.</li>
              <li>3. Apply voice, captions, and media matching automatically.</li>
              <li>4. Export or auto-publish from the ClipForge video tool.</li>
            </ol>
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
              href="/what-is-clipforge"
              aria-label="Read what ClipForge is"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              What Is ClipForge
            </Link>
            <Link
              href="/how-to-use-clipforge"
              aria-label="Learn how to use ClipForge"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              How To Use ClipForge
            </Link>
            <Link
              href="/clipforge-vs-competitors"
              aria-label="See ClipForge versus competitors"
              className="rounded-full border border-[#32507A] px-5 py-2.5 text-[#9DDCFF] transition hover:border-[#00D4FF]"
            >
              Compare ClipForge
            </Link>
            <Link
              href="/register"
              aria-label="Try ClipForge Free"
              className="rounded-full bg-[linear-gradient(to_right,#00D4FF,#7C5CFF)] px-5 py-2.5 text-[#0B0F1A]"
            >
              Try ClipForge Free
            </Link>
          </div>
        </article>
      </section>
      <SiteNavigation />
    </main>
  );
}
