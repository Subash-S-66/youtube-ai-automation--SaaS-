import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import path from "path";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /\/api\//,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /\/_next\/image\?url/,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "next-image-cache",
        },
      },
      {
        // Cache only first-party HTTPS requests to avoid interfering with third-party flows (e.g. Razorpay checkout).
        urlPattern: /^https:\/\/(www\.)?clipforgeapp\.tech\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "offlineCache",
          matchOptions: {
            ignoreSearch: false,
          },
          cacheableResponse: {
            statuses: [200],
          },
          expiration: {
            maxEntries: 200,
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, ".."),
  transpilePackages: ['lucide-react'], // Helps with tree-shaking
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }
    const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const destinationBase = raw.replace(/\/+$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${destinationBase}/api/:path*`,
      },
    ];
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  }
};

export default withPWA(nextConfig);
