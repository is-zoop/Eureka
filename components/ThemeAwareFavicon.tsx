"use client";

import { useEffect } from "react";
import { useTheme } from "@/hooks/useTheme";

const LIGHT_FAVICON = "/icons/logo-black-transparent.png";
const DARK_FAVICON = "/icons/logo-white-transparent.png";

/** Keeps the browser tab icon aligned with Eureka's resolved app theme. */
export function ThemeAwareFavicon() {
  const { isDark } = useTheme();

  useEffect(() => {
    const href = isDark ? DARK_FAVICON : LIGHT_FAVICON;
    const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');

    icons.forEach((icon) => {
      icon.href = href;
    });
  }, [isDark]);

  return null;
}
