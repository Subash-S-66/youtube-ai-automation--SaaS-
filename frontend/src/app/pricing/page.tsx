import type { Metadata } from 'next';
import JsonLdScript from '../../components/seo/JsonLdScript';
import SiteNavigation from '../../components/layout/SiteNavigation';
import PricingClient from './PricingClient';
import { buildBreadcrumbListSchema, buildPageMetadata } from '../../lib/seo';

export const metadata: Metadata = {
  ...buildPageMetadata({
    title: 'ClipForge Billing | Manage Your Subscription',
    description: 'Manage your ClipForge subscription, plan upgrades, and billing settings.',
    keywords: ['clipforge billing', 'clipforge subscription', 'clipforge plan management'],
    path: '/pricing',
  }),
  robots: {
    index: false,
    follow: false,
  },
};

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
