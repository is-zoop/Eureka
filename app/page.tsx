import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { readAuthSession } from "@/lib/auth/session";

export default async function Home() {
  if (!await readAuthSession()) redirect("/login?returnTo=/");
  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
