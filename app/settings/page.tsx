import { redirect } from "next/navigation";
import { SettingsPage } from "@/features/settings/ui/SettingsPage";
import { readAppSession } from "@/lib/auth/session";

export default async function Settings() {
  if (!await readAppSession()) redirect("/login?returnTo=/settings");
  return <SettingsPage />;
}
