import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { readAppSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await readAppSession();
  if (!session) redirect("/login?returnTo=/");
  return (
    <Suspense>
      <I18nProvider>
        <AppShell initialGuest={session.guest} />
      </I18nProvider>
    </Suspense>
  );
}
