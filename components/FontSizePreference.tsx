"use client";

import { useFontSize } from "@/hooks/useFontSize";

/** Keep the saved typography preference active throughout the application. */
export function FontSizePreference() {
  useFontSize();
  return null;
}
