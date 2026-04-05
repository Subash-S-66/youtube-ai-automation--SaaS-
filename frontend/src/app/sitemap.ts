import type { MetadataRoute } from "next";
import { getSiteUrl } from "../lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const now = new Date();

  const urls = [
    "/",
    "/clipforge",
    "/clipforge-ai",
    "/clipforge-video-tool",
    "/features",
    "/what-is-clipforge",
    "/clipforge-ai-video-tool",
    "/clipforge-review",
    "/how-to-use-clipforge",
    "/pricing",
  ];

  const highPriorityPaths = new Set([
    "/",
    "/clipforge",
    "/clipforge-ai",
    "/clipforge-video-tool",
    "/features",
    "/pricing",
  ]);

  return urls.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "daily" : highPriorityPaths.has(path) ? "weekly" : "monthly",
    priority: path === "/" ? 1 : highPriorityPaths.has(path) ? 0.9 : 0.8,
  }));
}
