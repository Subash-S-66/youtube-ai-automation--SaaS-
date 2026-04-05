import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import { getApiOrigin } from "../lib/apiBase";
import FramerMotionProvider from "../components/layout/FramerMotionProvider";
import ClientOnlyEnhancements from "../components/layout/ClientOnlyEnhancements";
import { getSiteUrl } from "../lib/site";
import { getAbsoluteUrl } from "../lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = getSiteUrl();

export const viewport = {
  themeColor: "#0B0F1A",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "ClipForge | Official AI Video Automation Tool",
  description:
    "ClipForge is an AI-powered platform that turns long videos into viral clips for TikTok, Instagram, and YouTube.",
  keywords: [
    "ClipForge",
    "ClipForge App",
    "ClipForge AI",
    "ClipForge video tool",
    "AI video generator",
    "automation",
    "content creation",
    "YouTube Shorts automation",
    "AI video automation platform",
  ],
  alternates: {
    canonical: getAbsoluteUrl('/'),
    languages: {
      'en-US': getAbsoluteUrl('/'),
      'x-default': getAbsoluteUrl('/'),
    },
  },
  openGraph: {
    type: "website",
    url: getAbsoluteUrl('/'),
    siteName: "ClipForge",
    title: "ClipForge | Official AI Video Automation Tool",
    description:
      "ClipForge is an AI-powered platform that turns long videos into viral clips for TikTok, Instagram, and YouTube.",
    images: [
      {
        url: getAbsoluteUrl('/brand-logo.png'),
        width: 1024,
        height: 1024,
        alt: "ClipForge",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ClipForge | Official AI Video Automation Tool",
    description: "ClipForge is an AI-powered platform for fast video-to-viral-clip automation.",
    images: [getAbsoluteUrl('/brand-logo.png')],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-video-preview": -1,
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/icons/favicon-64x64.png", sizes: "64x64", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ClipForge",
  },
  // Added to satisfy PWA requirements explicitly
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const apiOrigin = getApiOrigin();
  const websiteStructuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ClipForge",
    alternateName: ["ClipForge App"],
    url: siteUrl,
    description:
      "ClipForge is an AI video automation platform that turns long videos into viral shorts for TikTok, Instagram & YouTube.",
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  });
  const softwareApplicationStructuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ClipForge",
    url: siteUrl,
    applicationCategory: "VideoEditingApplication",
    operatingSystem: "Web",
    description:
      "ClipForge is an AI-powered platform that turns long videos into viral clips for TikTok, Instagram, and YouTube.",
  });
  const performanceApiPolyfill = `
    (function () {
      if (typeof globalThis === 'undefined') return;
      var scope = globalThis;
      var perf = scope.performance;
      var noop = function () {};
      var ensureFn = function (target, method, fallback) {
        if (!target) return;
        var next = fallback || noop;
        if (typeof target[method] === 'function') return;
        try {
          Object.defineProperty(target, method, {
            configurable: true,
            enumerable: false,
            writable: true,
            value: next,
          });
          return;
        } catch (_) {}
        try {
          target[method] = next;
        } catch (_) {}
      };

      if (!perf) return;
      ensureFn(perf, 'mark', noop);
      ensureFn(perf, 'measure', noop);
      ensureFn(perf, 'clearMarks', noop);
      ensureFn(perf, 'clearMeasures', noop);
      ensureFn(perf, 'getEntriesByName', function () { return []; });

      var proto = Object.getPrototypeOf(perf);
      ensureFn(proto, 'mark', noop);
      ensureFn(proto, 'measure', noop);
      ensureFn(proto, 'clearMarks', noop);
      ensureFn(proto, 'clearMeasures', noop);
      ensureFn(proto, 'getEntriesByName', function () { return []; });
    })();
  `;

  return (
    <html lang="en">
      <head>
        <Script id="performance-api-polyfill" strategy="beforeInteractive">
          {performanceApiPolyfill}
        </Script>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: websiteStructuredData }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: softwareApplicationStructuredData }}
        />
        <link rel="preload" href="/brand-logo.png" as="image" fetchPriority="high" />
        <link rel="preconnect" href={apiOrigin} />
        <link rel="dns-prefetch" href={apiOrigin} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <FramerMotionProvider>
          <ClientOnlyEnhancements />
          {children}
        </FramerMotionProvider>
      </body>
    </html>
  );
}
