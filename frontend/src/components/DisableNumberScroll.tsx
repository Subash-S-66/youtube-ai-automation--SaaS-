"use client";

import { useEffect } from "react";

export default function DisableNumberScroll() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (target instanceof HTMLInputElement && target.type === "number") {
        // Prevent wheel from changing number inputs when focused/hovered.
        event.preventDefault();
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  return null;
}
