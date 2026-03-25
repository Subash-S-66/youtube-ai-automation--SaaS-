import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import dynamic from "next/dynamic";
import { getApiOrigin } from "../lib/apiBase";
import FramerMotionProvider from "../components/layout/FramerMotionProvider";

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
  title: "ClipForge",
  description: "Premium SaaS Video Generation Dashboard",
  manifest: "/manifest.json",
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

  return (
    <html lang="en">
      <head>
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
