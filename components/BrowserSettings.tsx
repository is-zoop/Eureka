"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontalIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { accountCommand, DEFAULT_BROWSER_ID, type WebsiteAccount } from "@/lib/automation-accounts";
import { isDesktopBrowserHost } from "@/lib/native-browser";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { SettingsCard, SettingsLayout, SettingsRow, SettingsSection } from "./SettingsLayout";

type AccountAction = Parameters<typeof accountCommand>[1];
type AccountOptions = NonNullable<Parameters<typeof accountCommand>[2]>;
type Confirmation = { action: "reset" | "delete"; account: WebsiteAccount; owner: string };

async function readOwner() {
  const response = await fetch("/api/automation/identity", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const identity = await response.json();
  if (!response.ok || typeof identity.ownerKey !== "string") throw new Error(response.status === 401 ? "authenticationRequired" : "identityUnavailable");
  return identity.ownerKey as string;
}

export function BrowserSettings() {
  const { t } = useI18n();
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const [owner, setOwner] = useState<string | null>(null), [accounts, setAccounts] = useState<WebsiteAccount[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false), [name, setName] = useState(""), [website, setWebsite] = useState("");
  const [editing, setEditing] = useState<{ id: string; owner: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const alive = useRef(false), reading = useRef(false), acting = useRef(false), generation = useRef(0);
  const loadedOwner = useRef<string | null>(null);

  const errorMessage = useCallback((cause: unknown) => {
    const code = cause instanceof Error ? cause.message : "accountStorageFailed";
    if (cause instanceof Error && cause.name === "TimeoutError") return t("browserSettings.timeout");
    if (code === "authenticationRequired") return t("browserSettings.signIn");
    if (code === "identityUnavailable") return t("browserSettings.identityUnavailable");
    const known = ["accountInvalid", "accountStorageFailed", "accountMissing", "accountBusy", "accountAlreadyExists", "accountCleanupRequired", "desktopUpdateRequired"];
    return known.includes(code) ? t(`automation.accounts.error.${code}`) : t("browserSettings.failed");
  }, [t]);

  const reload = useCallback(async () => {
    if (acting.current || reading.current || !isDesktopBrowserHost()) return;
    const token = ++generation.current; reading.current = true; setLoading(true); setError("");
    try {
      const currentOwner = await readOwner(), data = await accountCommand(currentOwner, "list");
      if (await readOwner() !== currentOwner) throw new Error("authenticationRequired");
      if (alive.current && token === generation.current) {
        if (loadedOwner.current && loadedOwner.current !== currentOwner) { setCreateOpen(false); setEditing(null); setConfirmation(null); setName(""); setWebsite(""); }
        loadedOwner.current = currentOwner; setOwner(currentOwner); setAccounts(data.accounts);
      }
    } catch (cause) {
      if (alive.current && token === generation.current) { setOwner(null); setAccounts([]); setCreateOpen(false); setEditing(null); setConfirmation(null); setName(""); setWebsite(""); setError(errorMessage(cause)); }
    } finally {
      if (token === generation.current) { reading.current = false; if (alive.current) setLoading(false); }
    }
  }, [errorMessage]);

  useEffect(() => {
    alive.current = true; reading.current = false;
    const available = isDesktopBrowserHost(); setDesktop(available);
    if (available) void reload(); else setLoading(false);
    const onFocus = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("focus", onFocus);
    return () => { alive.current = false; ++generation.current; reading.current = false; window.removeEventListener("focus", onFocus); };
  }, [reload]);

  async function change(action: AccountAction, options: AccountOptions, expectedOwner = owner) {
    if (!expectedOwner || expectedOwner !== owner || acting.current || reading.current || !alive.current) return false;
    const token = ++generation.current; acting.current = true; setBusy(true); setError("");
    try {
      const data = await accountCommand(expectedOwner, action, options);
      if (await readOwner() !== expectedOwner) throw new Error("authenticationRequired");
      if (!alive.current || token !== generation.current) return false;
      setAccounts(data.accounts);
      window.dispatchEvent(new Event("eureka:browser-environments-changed"));
      return true;
    } catch (cause) {
      if (alive.current && token === generation.current) {
        setError(errorMessage(cause));
        if (cause instanceof Error && cause.message === "authenticationRequired") { setOwner(null); setAccounts([]); setCreateOpen(false); setEditing(null); setConfirmation(null); setName(""); setWebsite(""); }
      }
      return false;
    } finally { acting.current = false; if (alive.current) setBusy(false); }
  }

  async function saveEnvironment() {
    setError("");
    let origin: string;
    try {
      const url = new URL(website.trim());
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error();
      if (!name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error();
      origin = url.origin;
    } catch { setError(t("browserSettings.invalidInput")); return; }
    const target = editing, id = target?.id ?? crypto.randomUUID().replaceAll("-", "");
    if (await change(target ? "update" : "create", { id, name: name.trim(), origin }, target?.owner ?? owner)) { setCreateOpen(false); setEditing(null); setName(""); setWebsite(""); }
  }

  const disabled = loading || busy || !owner;
  const defaultAccount = accounts.find(account => account.id === DEFAULT_BROWSER_ID && !account.deleted);
  const environments = accounts.filter(account => account.id !== DEFAULT_BROWSER_ID && !account.deleted);
  const pending = accounts.filter(account => account.cleanupPending);
  const accountName = (account: WebsiteAccount) => account.id === DEFAULT_BROWSER_ID ? t("browserSettings.default") : account.name;

  function passwordRow(account: WebsiteAccount) {
    return <SettingsRow label={t("browserSettings.passwordSaving")} description={t("browserSettings.passwordDescription")} htmlFor={`browser-password-${account.id}`}>
      <Switch id={`browser-password-${account.id}`} checked={account.passwordAutosave} disabled={disabled} onCheckedChange={enabled => void change("passwords", { id: account.id, enabled })} />
    </SettingsRow>;
  }
  function management(account: WebsiteAccount) {
    return <DropdownMenu><DropdownMenuTrigger disabled={disabled} render={<Button variant="ghost" size="icon" aria-label={t("browserSettings.manage", { name: accountName(account) })} />}><MoreHorizontalIcon size={17} /></DropdownMenuTrigger><DropdownMenuContent align="end">
      {account.id !== DEFAULT_BROWSER_ID && <DropdownMenuItem disabled={disabled || account.inUse} onClick={() => { setError(""); setEditing({ id: account.id, owner: owner! }); setName(account.name); setWebsite(account.origin); setCreateOpen(true); }}>{t("browserSettings.edit")}</DropdownMenuItem>}
      <DropdownMenuItem disabled={disabled || account.inUse} onClick={() => { setError(""); setConfirmation({ action: "reset", account, owner: owner! }); }}>{t("browserSettings.clearLogin")}</DropdownMenuItem>
      {account.id !== DEFAULT_BROWSER_ID && <DropdownMenuItem variant="destructive" disabled={disabled || account.inUse} onClick={() => { setError(""); setConfirmation({ action: "delete", account, owner: owner! }); }}>{t("browserSettings.delete")}</DropdownMenuItem>}
    </DropdownMenuContent></DropdownMenu>;
  }

  return <SettingsLayout title={t("settings.browser")} description={t("browserSettings.description")} actions={desktop && <>
    <Button variant="outline" size="icon" disabled={loading || busy} aria-label={t("browserSettings.refresh")} onClick={() => void reload()}><RefreshCwIcon size={15} /></Button>
    <Button type="button" size="sm" className="gap-1.5" disabled={disabled} onClick={() => { setError(""); setEditing(null); setName(""); setWebsite(""); setCreateOpen(true); }}><PlusIcon size={13} strokeWidth={1.6} aria-hidden="true" />{t("browserSettings.create")}</Button>
  </>}>
    {error && !createOpen && !confirmation && <p role="alert" className="m-0 text-sm text-[var(--danger,#b42318)]">{error}</p>}
    {desktop === null || loading && !accounts.length ? <p role="status" className="text-sm text-[var(--text-muted)]">{t("browserSettings.loading")}</p> : !desktop ? <SettingsCard className="px-4"><SettingsRow label={t("browserSettings.desktopOnly")} description={t("browserSettings.desktopDescription")}><span /></SettingsRow></SettingsCard> : <>
      {defaultAccount && <SettingsSection title={t("browserSettings.default")}>
        <SettingsCard className="divide-y divide-[var(--border)] px-4">
          <SettingsRow label={t("browserSettings.default")} description={defaultAccount.inUse ? t("browserSettings.inUseHint") : t("browserSettings.defaultDescription")}>{management(defaultAccount)}</SettingsRow>
          {passwordRow(defaultAccount)}
        </SettingsCard>
      </SettingsSection>}
      {owner && <SettingsSection title={t("browserSettings.environments")} description={t("browserSettings.environmentsDescription")} meta={environments.length}>
        {environments.length ? <div className="flex flex-col gap-3">{environments.map(account => <SettingsCard key={account.id} className="divide-y divide-[var(--border)] px-4">
          <SettingsRow label={account.name} description={`${account.origin}${account.inUse ? ` · ${t("browserSettings.inUseHint")}` : ""}`}>{management(account)}</SettingsRow>
          {passwordRow(account)}
        </SettingsCard>)}</div> : <SettingsCard className="px-4"><SettingsRow label={t("browserSettings.empty")} description={t("browserSettings.emptyDescription")}><span /></SettingsRow></SettingsCard>}
      </SettingsSection>}
      {pending.length > 0 && <SettingsSection title={t("browserSettings.pendingCleanup")} description={t("browserSettings.cleanupDescription")}>
        <SettingsCard className="divide-y divide-[var(--border)] px-4">{pending.map(account => <SettingsRow key={account.id} label={accountName(account)} description={account.deleted ? t("browserSettings.deletedPending") : t("browserSettings.retiredPending")}>
          <Button variant="outline" size="sm" disabled={disabled || account.inUse} onClick={() => void change("cleanup", { id: account.id })}>{t("browserSettings.retryCleanup")}</Button>
        </SettingsRow>)}</SettingsCard>
      </SettingsSection>}
    </>}
    <Dialog open={createOpen} onOpenChange={open => { if (!acting.current) setCreateOpen(open); }}><DialogContent>
      <DialogHeader><DialogTitle>{t(editing ? "browserSettings.edit" : "browserSettings.create")}</DialogTitle></DialogHeader>
      <DialogBody><form id="browser-environment-form" onSubmit={event => { event.preventDefault(); void saveEnvironment(); }} className="flex flex-col gap-5">
        {error && <p role="alert" className="m-0 text-sm text-[var(--danger,#b42318)]">{error}</p>}
        <div className="flex flex-col gap-2"><label htmlFor="browser-environment-name" className="text-[13px] font-medium">{t("browserSettings.name")}</label><Input id="browser-environment-name" value={name} maxLength={80} required disabled={busy} autoComplete="off" onChange={event => setName(event.target.value)} placeholder={t("browserSettings.namePlaceholder")} /></div>
        <div className="flex flex-col gap-2"><label htmlFor="browser-environment-website" className="text-[13px] font-medium">{t("browserSettings.website")}</label><Input id="browser-environment-website" type="url" value={website} required disabled={busy} autoComplete="off" onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" /><p className="m-0 text-[11px] text-[var(--text-muted)]">{t("browserSettings.websiteDescription")}</p></div>
      </form></DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setCreateOpen(false)}>{t("browserSettings.cancel")}</Button><Button type="submit" form="browser-environment-form" disabled={disabled}>{t(editing ? "browserSettings.save" : "browserSettings.create")}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={Boolean(confirmation)} onOpenChange={open => { if (!open && !acting.current) setConfirmation(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{t(confirmation?.action === "delete" ? "browserSettings.delete" : "browserSettings.clearLogin")}</DialogTitle></DialogHeader>
      <DialogBody>{confirmation && <p className="m-0 text-sm leading-6">{t(confirmation.action === "delete" ? "browserSettings.confirmDelete" : "browserSettings.confirmClear", { name: accountName(confirmation.account) })}</p>}{error && <p role="alert" className="mt-3 text-sm text-[var(--danger,#b42318)]">{error}</p>}</DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>{t("browserSettings.cancel")}</Button><Button variant="destructive" disabled={disabled} onClick={() => { const target = confirmation; if (target) void change(target.action, { id: target.account.id }, target.owner).then(ok => { if (ok && alive.current) setConfirmation(null); }); }}>{t("browserSettings.confirm")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </SettingsLayout>;
}
