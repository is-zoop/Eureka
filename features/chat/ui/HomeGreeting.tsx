"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

export function HomeGreeting({ userName }: { userName?: string | null }) {
  const { t } = useI18n();
  const [hour, setHour] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setHour(new Date().getHours());
    update();
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const name = userName?.trim() || t("chat.homeGuestName");
  const period = hour === null ? "welcome" : hour >= 6 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
  return <>{t(`chat.homeGreeting.${period}`, { name })}</>;
}
