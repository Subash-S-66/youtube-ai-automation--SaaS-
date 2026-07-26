import type { MetadataRoute } from "next";
import { getSiteUrl } from "../lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastmod = new Date().toISOString();

  const entries: Array<{
    path: string;
    changeFrequency: 'daily' | 'weekly' | 'monthly';
    priority: number;
  }> = [
    { path: '/', changeFrequency: 'daily', priority: 1.0 },
    { path: '/clipforge', changeFrequency: 'weekly', priority: 1.0 },
    { path: '/clipforge-ai', changeFrequency: 'weekly', priority: 1.0 },
    { path: '/clipforge-video-tool', changeFrequency: 'weekly', priority: 1.0 },
    { path: '/features', changeFrequency: 'weekly', priority: 0.95 },
    { path: '/what-is-clipforge', changeFrequency: 'weekly', priority: 0.9 },
    { path: '/clipforge-ai-video-tool', changeFrequency: 'weekly', priority: 0.9 },
    { path: '/clipforge-review', changeFrequency: 'weekly', priority: 0.9 },
    { path: '/how-to-use-clipforge', changeFrequency: 'weekly', priority: 0.9 },
    { path: '/price', changeFrequency: 'monthly', priority: 0.8 },
    { path: '/clipforge-vs-competitors', changeFrequency: 'weekly', priority: 0.8 },
    { path: '/privacy-policy', changeFrequency: 'monthly', priority: 0.5 },
    { path: '/terms-of-service', changeFrequency: 'monthly', priority: 0.5 },
  ];

  return entries.map((entry) => ({
    url: `${siteUrl}${entry.path}`,
    lastModified: lastmod,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
