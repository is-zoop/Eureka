"use client";

import { useRef, useState } from "react";
import { ArrowUpRightIcon, ChevronDownIcon, ClockIcon, TicketIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { invalidateSubscriptionQuotaPreview, useSubscriptionQuotaPreview, type useSubscriptionQuotas } from "@/features/settings/client/useSubscriptionQuotas";
import { subscriptionUsagePages, type SubscriptionAccount, type SubscriptionResetCredit, type SubscriptionResetResult, type SubscriptionWindow } from "@/features/settings/shared/subscription-quotas";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "./ProviderIcon";
import { SettingsCard, SettingsSection } from "../../../components/SettingsLayout";
import { Button } from "../../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Skeleton } from "../../../components/ui/skeleton";

const requestPath = "/api/subscription-quotas";
type QuotaState = ReturnType<typeof useSubscriptionQuotas>;
type ResetSelection = { account: SubscriptionAccount; credit: SubscriptionResetCredit };

function formatDate(timestamp: number, locale: string, time = true) {
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.valueOf())) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(time && { hour: "2-digit", minute: "2-digit", hour12: false }) }).format(date);
}

function resetCreditTitle(credit: SubscriptionResetCredit, fullReset: string) {
  return !credit.title || /^full reset$/i.test(credit.title) ? fullReset : credit.title;
}

function QuotaWindow({ window: quota, showGroup }: { window: SubscriptionWindow; showGroup: boolean }) {
  const { t, locale } = useI18n();
  const label = quota.windowMinutes === 300 ? t("subscriptions.fiveHours")
    : quota.windowMinutes === 10_080 ? t("subscriptions.weekly") : quota.label;
  const reset = quota.resetsAt ? formatDate(quota.resetsAt, locale) : "";
  const remaining = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(quota.remainingPercent);
  return <div className="min-w-0 space-y-1.5">
    <div className="flex items-baseline justify-between gap-2 text-[13px]">
      <span>{label}{showGroup && quota.group && <span className="ml-1.5 text-xs text-[var(--text-muted)]">{quota.group}</span>}</span>
      <span className="shrink-0 whitespace-nowrap text-xs text-[var(--text-muted)]">{t("subscriptions.remaining")} <strong className="ml-1 tabular-nums text-[16px] font-semibold text-[var(--text)]">{remaining}%</strong></span>
    </div>
    <div role="progressbar" aria-label={showGroup && quota.group ? `${quota.group} ${label}` : label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={quota.remainingPercent} className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]">
      <div className={cn("h-full rounded-full", quota.remainingPercent <= 20 ? "bg-amber-600 dark:bg-amber-400" : "bg-emerald-600 dark:bg-emerald-400")} style={{ width: `${quota.remainingPercent}%` }} />
    </div>
    {reset && <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]"><ClockIcon size={13} aria-hidden="true" />{t("subscriptions.resetsAt", { date: reset })}</div>}
  </div>;
}

function ResetSummary({ resets }: { resets: NonNullable<SubscriptionAccount["resets"]> }) {
  const { t, locale } = useI18n();
  const expiry = resets.nextExpiry ? formatDate(resets.nextExpiry, locale, false) : "";
  return <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
    <span className="inline-flex shrink-0 items-center gap-1.5 font-medium"><TicketIcon size={15} aria-hidden="true" />{t("subscriptions.credits")}</span>
    <span className="shrink-0 whitespace-nowrap rounded-[4px] bg-[var(--bg-hover)] px-1.5 py-0.5 tabular-nums">{t("subscriptions.available", { count: resets.available })}</span>
    {expiry && <span className="text-[var(--text-muted)]">{t("subscriptions.expiry", { date: expiry })}</span>}
  </span>;
}

function ResetCredits({ account, onSelect, onJump }: { account: SubscriptionAccount; onSelect?: (selection: ResetSelection) => void; onJump?: () => void }) {
  const { t, locale } = useI18n();
  if (!account.resets) return null;
  const resets = account.resets;
  const credits = resets.credits ?? [];
  if (onJump) return <div className="mx-3 flex flex-wrap items-center justify-between gap-1 border-t border-[var(--border)] py-1.5">
    <ResetSummary resets={resets} />
    <DropdownMenuItem onClick={onJump} className="ml-auto whitespace-nowrap border border-[var(--border)] px-2 text-xs">{t("subscriptions.viewResets")}</DropdownMenuItem>
  </div>;

  return <Collapsible className="mx-4 border-t border-[var(--border)]">
    <CollapsibleTrigger className="group flex min-h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] text-left focus-visible:outline-2 focus-visible:outline-[var(--accent)]" aria-label={t("subscriptions.viewResets")}>
      <ResetSummary resets={resets} />
      <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-[var(--text-muted)] group-aria-expanded:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className="mb-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--chat-bg)] px-3">
        <div className="border-b border-[var(--border)] py-2 text-xs font-medium">{t("subscriptions.available", { count: resets.available })}</div>
        {credits.length ? <ul className="m-0 list-none divide-y divide-[var(--border)] p-0">
          {credits.map((credit) => <li key={credit.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{resetCreditTitle(credit, t("subscriptions.fullReset"))}</div>
              {credit.expiresAt && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{t("subscriptions.ticketExpiry", { date: formatDate(credit.expiresAt, locale) })}</div>}
            </div>
            <Button type="button" size="sm" variant="outline" disabled={!credit.quote || !onSelect} onClick={() => onSelect?.({ account, credit })}>{t("subscriptions.useReset")}</Button>
          </li>)}
        </ul> : <p className="my-0 py-3 text-xs text-[var(--text-muted)]">{t("subscriptions.noCredits")}</p>}
      </div>
    </CollapsibleContent>
  </Collapsible>;
}

function AccountCard({ account, onSelect, onJump }: { account: SubscriptionAccount; onSelect?: (selection: ResetSelection) => void; onJump?: () => void }) {
  const { t } = useI18n();
  const url = Object.hasOwn(subscriptionUsagePages, account.id) ? subscriptionUsagePages[account.id] : undefined;
  const showGroup = new Set(account.windows.map((quota) => quota.group)).size > 1;
  const compact = Boolean(onJump);
  return <SettingsCard role="article" aria-label={account.name}>
    <div className={cn("flex flex-wrap items-center justify-between gap-2", compact ? "px-3 py-2" : "px-4 py-3")}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-panel)]"><ProviderIcon id={account.id} size={18} /></span>
        <div className="min-w-0">
          <div className="break-words text-[13px] font-semibold">{account.name}</div>
          {account.plan && <div className="break-words text-xs text-[var(--text-muted)]">{account.plan}</div>}
          {account.status === "unavailable" && <div className="text-xs text-[var(--text-muted)]">{t("subscriptions.unavailable")}</div>}
        </div>
      </div>
      {url && !compact && <a href={url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:underline">{t("subscriptions.official")}<ArrowUpRightIcon size={13} aria-hidden="true" /></a>}
    </div>
    {account.windows.length > 0 && <div className={cn("grid grid-cols-1 gap-3 border-t border-[var(--border)] py-3", compact ? "mx-3" : "mx-4")}>
      {account.windows.map((quota) => <QuotaWindow key={quota.id} window={quota} showGroup={showGroup} />)}
    </div>}
    <ResetCredits account={account} onSelect={onSelect} onJump={onJump} />
  </SettingsCard>;
}

function AccountList({ state, onSelect, onJump }: { state: Pick<QuotaState, "data" | "status">; onSelect?: (selection: ResetSelection) => void; onJump?: () => void }) {
  const { t } = useI18n();
  if ((state.status === "error" && !onJump) || !state.data?.accounts.length) {
    const message = state.status === "loading" && !state.data ? "subscriptions.loading"
      : state.status === "error" ? "subscriptions.loadFailed"
      : "subscriptions.empty";
    return <p role="status" className="m-0 px-2 py-3 text-xs text-[var(--text-muted)]">{t(message)}</p>;
  }
  return <div aria-busy={state.status === "loading"} className="grid gap-2.5">{state.data.accounts.map((account) => <AccountCard key={account.id} account={account} onSelect={state.status === "ready" ? onSelect : undefined} onJump={onJump} />)}</div>;
}

function QuotaPreviewSkeleton({ label }: { label: string }) {
  return <SettingsCard role="status" aria-busy="true" aria-label={label} className="motion-reduce:[&_[data-slot=skeleton]]:animate-none">
    <div className="flex items-center gap-2.5 px-3 py-2">
      <Skeleton className="size-8 shrink-0 rounded-[var(--radius-control)]" />
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-2.5 w-16" />
      </div>
    </div>
    <div className="mx-3 grid gap-3 border-t border-[var(--border)] py-3">
      {[0, 1].map((row) => <div key={row} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3.5 w-10" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
        <Skeleton className="h-2.5 w-24" />
      </div>)}
    </div>
  </SettingsCard>;
}

export function SubscriptionQuotaPreview({ onJump }: { onJump: () => void }) {
  const { t } = useI18n();
  const state = useSubscriptionQuotaPreview();
  return <div className="p-1.5">
    {state.status === "loading" && !state.data
      ? <QuotaPreviewSkeleton label={t("subscriptions.loading")} />
      : <AccountList state={state} onJump={onJump} />}
    {state.status === "error" && Boolean(state.data?.accounts.length) && <p role="status" className="m-0 px-2 pt-2 text-xs text-[var(--text-muted)]">{t("subscriptions.previewStale")}</p>}
    {!state.data?.accounts.some((account) => account.resets) && <DropdownMenuItem className="mt-1 text-xs" onClick={onJump}>{t("subscriptions.openPage")}<ArrowUpRightIcon className="ml-auto" /></DropdownMenuItem>}
  </div>;
}

export function SubscriptionQuotaSettings({ state }: { state: QuotaState }) {
  const { t, locale } = useI18n();
  const [selection, setSelection] = useState<ResetSelection | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SubscriptionResetResult | null>(null);
  const pendingRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  async function confirm() {
    if (!selection?.credit.quote || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const response = await fetch(requestPath, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selection.account.id, credit: selection.credit.id, quote: selection.credit.quote }),
      });
      if (!response.ok) throw new Error("Reset response unavailable");
      const body = await response.json() as { result: SubscriptionResetResult };
      setResult(body.result);
    } catch {
      setResult("unknown");
    } finally {
      setSelection(null);
      pendingRef.current = false;
      setPending(false);
      invalidateSubscriptionQuotaPreview();
      void state.refresh();
    }
  }

  return <SettingsSection title={t("subscriptions.accounts")}>
    {result && <SettingsCard role="status" className="mb-3 px-3.5 py-2.5 text-xs">{t(`subscriptions.result.${result}`)}</SettingsCard>}
    <AccountList state={state} onSelect={(next) => { setResult(null); setSelection(next); }} />
    <Dialog open={selection !== null} onOpenChange={(open) => { if (!open && !pendingRef.current) setSelection(null); }}>
      <DialogContent className="max-w-[430px]" initialFocus={cancelRef}>
        <DialogHeader>
          <DialogTitle>{t("subscriptions.confirmTitle")}</DialogTitle>
          <DialogDescription>{t(selection?.account.id === "openai" ? "subscriptions.confirmOpenAI" : "subscriptions.confirmDescription")}</DialogDescription>
        </DialogHeader>
        {selection && <DialogBody className="space-y-1 text-[13px]">
          <div className="font-medium">{selection.account.email || selection.account.name}</div>
          <div>{resetCreditTitle(selection.credit, t("subscriptions.fullReset"))}</div>
          {selection.credit.expiresAt && <div className="text-xs text-[var(--text-muted)]">{t("subscriptions.ticketExpiry", { date: formatDate(selection.credit.expiresAt, locale) })}</div>}
        </DialogBody>}
        <DialogFooter>
          <button ref={cancelRef} type="button" className="h-8 rounded-[var(--radius-control)] border border-[var(--border)] px-3 text-xs hover:bg-[var(--bg-hover)]" disabled={pending} onClick={() => setSelection(null)}>{t("chat.cancel")}</button>
          <Button size="sm" type="button" disabled={pending || !selection?.credit.quote} onClick={() => void confirm()}>{t(pending ? "subscriptions.submitting" : "subscriptions.confirmAction")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </SettingsSection>;
}
