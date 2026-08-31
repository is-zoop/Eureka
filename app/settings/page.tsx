import { redirect } from "next/navigation";
import { SettingsPage } from "@/components/SettingsPage";
import { I18nProvider } from "@/hooks/useI18n";
import { readAuthSession } from "@/lib/auth/session";

export default async function Settings() {
  if (!await readAuthSession()) redirect("/login?returnTo=/settings");
  return <I18nProvider><SettingsPage /></I18nProvider>;
}
