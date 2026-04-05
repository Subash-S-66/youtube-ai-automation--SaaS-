import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LandingPage from './landing/page';
import JsonLdScript from '../components/seo/JsonLdScript';
import SiteNavigation from '../components/layout/SiteNavigation';
import { buildBreadcrumbListSchema, buildPageMetadata } from '../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'ClipForge - Turn Videos Into Viral Clips in Seconds (AI Tool)',
  description:
    'ClipForge is an AI-powered platform that turns long videos into viral clips for TikTok, Instagram, and YouTube in seconds.',
  keywords: [
    'ClipForge',
    'ClipForge app',
    'ClipForge AI',
    'ClipForge video tool',
    'AI video automation platform',
    'viral shorts creator',
  ],
  path: '/',
});

export default async function Home() {
  const cookieStore = await cookies();
  const hasToken =
    cookieStore.has('token') ||
    cookieStore.has('jwt') ||
    cookieStore.has('authToken');

  if (hasToken) {
    redirect('/dashboard');
  }

  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
  ]);

  return (
    <>
      <JsonLdScript id="home-breadcrumb-schema" data={breadcrumbSchema} />
      <LandingPage />
      <SiteNavigation />
    </>
  );
}
