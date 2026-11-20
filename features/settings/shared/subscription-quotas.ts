export interface SubscriptionWindow {
  id: string;
  label: string;
  group?: string;
  remainingPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
}

export interface SubscriptionResetCredit {
  id: string;
  title: string;
  expiresAt?: number;
  quote?: string;
}

export interface SubscriptionAccount {
  id: string;
  name: string;
  plan?: string;
  email?: string;
  status: "ready" | "unavailable";
  windows: SubscriptionWindow[];
  resets?: { available: number; nextExpiry?: number; credits?: SubscriptionResetCredit[] };
}

export interface SubscriptionQuotas {
  accounts: SubscriptionAccount[];
}

export type SubscriptionResetResult = "reset" | "already_redeemed" | "nothing_to_reset" | "no_credit" | "stale" | "unknown";

export const subscriptionUsagePages: Record<string, string> = {
  "openai-codex": "https://chatgpt.com/codex/settings/usage",
  openai: "https://chatgpt.com/settings/usage",
  xai: "https://grok.com/dashboard/usage",
  "xai-auth": "https://grok.com/dashboard/usage",
  anthropic: "https://claude.ai/settings/usage",
  "claude-bridge": "https://claude.ai/settings/usage",
  "github-copilot": "https://github.com/settings/billing",
};
