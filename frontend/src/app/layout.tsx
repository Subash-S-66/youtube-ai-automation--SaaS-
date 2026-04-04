import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import dynamic from "next/dynamic";
import Script from "next/script";
import { getApiOrigin } from "../lib/apiBase";
import FramerMotionProvider from "../components/layout/FramerMotionProvider";
import { getSiteUrl } from "../lib/site";

const GlobalBanner = dynamic(() => import("../components/layout/GlobalBanner"));
const DisableNumberScroll = dynamic(() => import("../components/DisableNumberScroll"));

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport = {
  themeColor: "#0B0F1A",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: "ClipForge - AI Video Automation Platform | Create Viral Shorts",
  description:
    "ClipForge is an AI video automation platform that turns long videos into viral shorts for TikTok, Instagram & YouTube.",
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
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "ClipForge",
    title: "ClipForge - AI That Turns Videos into Viral Shorts (Free, Fast, No Editing Needed)",
    description:
      "ClipForge is an AI video automation platform that turns long videos into viral shorts for TikTok, Instagram & YouTube.",
    images: [
      {
        url: "/brand-logo.png",
        width: 1024,
        height: 1024,
        alt: "ClipForge",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ClipForge - AI That Turns Videos into Viral Shorts (Free, Fast, No Editing Needed)",
    description: "ClipForge app is free to start, fast to use, and needs no manual editing.",
    images: ["/brand-logo.png"],
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
  const siteUrl = getSiteUrl();
  const structuredData = JSON.stringify({
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
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
        <link rel="preconnect" href={apiOrigin} />
        <link rel="dns-prefetch" href={apiOrigin} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <FramerMotionProvider>
          <GlobalBanner />
          <DisableNumberScroll />
          {children}
        </FramerMotionProvider>
      </body>
    </html>
  );
}
