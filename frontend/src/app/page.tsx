import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LandingPage from './landing/page';

export const metadata: Metadata = {
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
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'ClipForge - Turn Videos Into Viral Clips in Seconds (AI Tool)',
    description:
      'ClipForge is an AI-powered platform that turns long videos into viral clips for TikTok, Instagram, and YouTube in seconds.',
    url: '/',
    siteName: 'ClipForge',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClipForge - Turn Videos Into Viral Clips in Seconds (AI Tool)',
    description:
      'ClipForge is an AI-powered platform that helps creators turn long videos into viral clips with minimal manual editing.',
  },
};

export default async function Home() {
  const cookieStore = await cookies();
  const hasToken =
    cookieStore.has('token') ||
    cookieStore.has('jwt') ||
    cookieStore.has('authToken');

  if (hasToken) {
    redirect('/dashboard');
  }

  return <LandingPage />;
}
