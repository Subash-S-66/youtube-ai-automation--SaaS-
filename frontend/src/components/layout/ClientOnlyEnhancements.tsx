"use client";

import dynamic from "next/dynamic";

const GlobalBanner = dynamic(() => import("./GlobalBanner"), {
  ssr: false,
  loading: () => null,
});

const DisableNumberScroll = dynamic(() => import("../DisableNumberScroll"), {
  ssr: false,
  loading: () => null,
});

export default function ClientOnlyEnhancements() {
  return (
    <>
      <GlobalBanner />
      <DisableNumberScroll />
    </>
  );
}
