import type { Metadata } from 'next';
import { getSiteUrl } from './site';

export interface PageMetadataConfig {
  title: string;
  description: string;
  keywords: string[];
  path: string;
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export interface IndexedPageLink {
  href: string;
  label: string;
}

export const indexedPageLinks: IndexedPageLink[] = [
  { href: '/', label: 'ClipForge home' },
  { href: '/clipforge', label: 'ClipForge overview' },
  { href: '/clipforge-ai', label: 'ClipForge AI' },
  { href: '/clipforge-video-tool', label: 'ClipForge video tool' },
  { href: '/features', label: 'ClipForge features' },
  { href: '/what-is-clipforge', label: 'What is ClipForge' },
  { href: '/clipforge-ai-video-tool', label: 'ClipForge AI video tool' },
  { href: '/clipforge-review', label: 'ClipForge review' },
  { href: '/how-to-use-clipforge', label: 'How to use ClipForge' },
  { href: '/price', label: 'ClipForge pricing' },
  { href: '/clipforge-vs-competitors', label: 'ClipForge vs competitors' },
];

export const getAbsoluteUrl = (path: string): string => {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const siteUrl = getSiteUrl();

  return normalizedPath === '/' ? siteUrl : `${siteUrl}${normalizedPath}`;
};

export const buildPageMetadata = ({
  title,
  description,
  keywords,
  path,
}: PageMetadataConfig): Metadata => {
  const canonical = getAbsoluteUrl(path);
  const image = getAbsoluteUrl('/brand-logo.png');

  return {
    metadataBase: new URL(getSiteUrl()),
    title,
    description,
    keywords,
    alternates: {
      canonical,
      languages: {
        'en-US': canonical,
        'x-default': canonical,
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'website',
      siteName: 'ClipForge',
      images: [
        {
          url: image,
          width: 1024,
          height: 1024,
          alt: 'ClipForge brand logo',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
};

export const buildBreadcrumbListSchema = (items: BreadcrumbItem[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: getAbsoluteUrl(item.path),
  })),
});
