import type { Metadata } from 'next';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import PricingClient from './PricingClient';
import { buildBreadcrumbListSchema, buildPageMetadata } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'ClipForge Pricing | Plans for AI Video Automation',
  description:
    'Compare ClipForge plans for creators and teams. Choose the right ClipForge app tier for output volume, channels, and automation depth.',
  keywords: [
    'clipforge pricing',
    'clipforge plans',
    'clipforge app pricing',
    'clipforge ai subscription',
    'clipforge video tool pricing',
  ],
  path: '/pricing',
});

export default function PricingPage() {
  const breadcrumbSchema = buildBreadcrumbListSchema([
    { name: 'Home', path: '/' },
    { name: 'Pricing', path: '/pricing' },
  ]);

  return (
    <>
      <JsonLdScript id="pricing-breadcrumb-schema" data={breadcrumbSchema} />
      <PricingClient />
      <SiteNavigation />
    </>
  );
}
