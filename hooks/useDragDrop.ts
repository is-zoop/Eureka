"use client";

import { useState, useCallback, useRef } from "react";

export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if ("__TAURI_INTERNALS__" in window) return; // The native path drop listener owns desktop files.
    const hasFiles = e.dataTransfer.types.includes("Files") || Array.from(e.dataTransfer.items).some((item) => item.kind === "file");
    if (!hasFiles) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if ("__TAURI_INTERNALS__" in window) return;
    const hasFiles = e.dataTransfer.types.includes("Files") || Array.from(e.dataTransfer.items).some((item) => item.kind === "file");
    if (!hasFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if ("__TAURI_INTERNALS__" in window) return;
    if (!e.dataTransfer.types.includes("Files") && !e.dataTransfer.files.length) return;
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    onDrop(files);
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
