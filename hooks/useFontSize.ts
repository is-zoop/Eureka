"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_STORAGE_KEY,
  getPreferredFontSize,
  normalizeFontSize,
  setPreferredFontSize,
  type FontSize,
} from "@/lib/font-size-preference";

const listeners = new Set<() => void>();
let current: FontSize | null = null;

function applySize(size: FontSize): void {
  document.documentElement.dataset.eurekaFontSize = size;
}

function getSnapshot(): FontSize {
  if (typeof window === "undefined") return DEFAULT_FONT_SIZE;
  return current ??= getPreferredFontSize();
}

function publish(size: FontSize): void {
  const changed = current !== size;
  current = size;
  applySize(size);
  if (changed) listeners.forEach((listener) => listener());
}

function handleStorage(event: StorageEvent): void {
  if (event.key === FONT_SIZE_STORAGE_KEY || event.key === null) {
    publish(normalizeFontSize(event.newValue));
  }
}

function subscribe(listener: () => void): () => void {
  applySize(getSnapshot());
  if (listeners.size === 0) window.addEventListener("storage", handleStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", handleStorage);
  };
}

export function useFontSize() {
  const fontSize = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_FONT_SIZE);
  const setFontSize = useCallback((size: FontSize) => {
    setPreferredFontSize(size);
    publish(size);
  }, []);
  return { fontSize, setFontSize };
}
