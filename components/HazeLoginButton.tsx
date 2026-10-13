"use client";

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loginInBrowser } from "@/lib/desktop-login-client";
import { Button } from "@/components/ui/button";

type LoginActionsProps = {
  desktop?: boolean;
  waiting?: boolean;
  cancelling?: boolean;
  skipping?: boolean;
  error?: string;
  onLogin: () => void;
  onCancel: () => void;
  onSkip: () => void;
};

export function HazeLoginActions({ desktop = false, waiting = false, cancelling = false, skipping = false, error = "", onLogin, onCancel, onSkip }: LoginActionsProps) {
  return <>
    <div className="flex w-full items-center gap-2">
      <Button className="min-w-0 flex-1" disabled={waiting || skipping} onClick={onLogin}>
        {waiting ? "等待浏览器授权…" : desktop ? "在浏览器中使用 Haze 登录" : "使用 Haze 登录"}
      </Button>
      {waiting && <Button variant="outline" className="shrink-0" disabled={cancelling || skipping} onClick={onCancel}>取消授权</Button>}
    </div>
    {error && <p role="alert" className="text-center text-xs text-[var(--danger)]">{error}</p>}
    <div className="flex w-full justify-end">
      <Button variant="link" className="h-auto px-0 py-1 underline underline-offset-4" disabled={skipping || cancelling} onClick={onSkip}>
        {skipping ? "正在进入…" : "跳过登录"}
      </Button>
    </div>
  </>;
}

export function HazeLoginButton({ returnTo }: { returnTo: string }) {
  const [desktop, setDesktop] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ controller: AbortController; done: Promise<void> } | null>(null);
  const skippingRef = useRef(false);

  useEffect(() => {
    setDesktop("__TAURI_INTERNALS__" in window);
    return () => { attempt.current?.controller.abort(); };
  }, []);

  const login = () => {
    if (attempt.current || skippingRef.current) return;
    if (!("__TAURI_INTERNALS__" in window)) {
      window.location.assign(`/api/marketplace-auth/start?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    const controller = new AbortController();
    setWaiting(true);
    setError("");
    const run = async () => {
      try {
        const target = await loginInBrowser({
          returnTo,
          signal: controller.signal,
          openBrowser: (url) => invoke("open_external_url", { url }),
          onWaiting: () => {},
        });
        if (!controller.signal.aborted) window.location.replace(target);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "登录暂时不可用，请重试。");
        }
      } finally {
        if (attempt.current?.controller === controller) {
          attempt.current = null;
          setWaiting(false);
        }
      }
    };
    attempt.current = { controller, done: run() };
  };

  const cancelAuthorization = async () => {
    const pending = attempt.current;
    if (!pending) return;
    pending.controller.abort();
    await pending.done;
  };

  const skipLogin = async () => {
    if (skippingRef.current) return;
    skippingRef.current = true;
    setSkipping(true);
    setError("");
    try {
      await cancelAuthorization();
      const response = await fetch("/api/marketplace-auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error("无法跳过登录，请重试。");
      window.location.replace(result.returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法跳过登录，请重试。");
      skippingRef.current = false;
      setSkipping(false);
    }
  };

  return <HazeLoginActions desktop={desktop} waiting={waiting} cancelling={cancelling} skipping={skipping} error={error}
    onLogin={login}
    onCancel={() => { void (async () => {
      setCancelling(true);
      await cancelAuthorization();
      setCancelling(false);
    })(); }}
    onSkip={() => void skipLogin()} />;
}
