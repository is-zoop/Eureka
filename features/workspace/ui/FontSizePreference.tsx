"use client";

import { useFontSize } from "@/features/workspace/client/useFontSize";

/** Keep the saved typography preference active throughout the application. */
export function FontSizePreference() {
  useFontSize();
  return null;
}
