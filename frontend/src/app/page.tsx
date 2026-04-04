import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LandingPage from './landing/page';

export const metadata: Metadata = {
  title: 'ClipForge - AI Video Automation Platform | Create Viral Shorts',
  description:
    'ClipForge is an AI video automation platform that turns long videos into viral shorts for TikTok, Instagram & YouTube.',
  keywords: [
    'clipforge',
    'clipforge app',
    'clipforge ai',
    'clipforge video tool',
    'ai video automation platform',
    'viral shorts creator',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'ClipForge - AI That Turns Videos into Viral Shorts (Free, Fast, No Editing Needed)',
    description:
      'ClipForge is an AI video automation platform that turns long videos into viral shorts for TikTok, Instagram & YouTube.',
    url: '/',
    siteName: 'ClipForge',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClipForge - AI That Turns Videos into Viral Shorts (Free, Fast, No Editing Needed)',
    description:
      'ClipForge is free to start, fast to publish, and requires no manual editing workflow.',
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
