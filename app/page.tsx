import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { readAppSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await readAppSession();
  if (!session) redirect("/login?returnTo=/");
  return (
    <Suspense>
      <AppShell initialGuest={session.guest} />
    </Suspense>
  );
}
