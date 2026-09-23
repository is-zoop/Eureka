"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import type { ComponentProps } from "react";

export function RadioGroup({ className = "", ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={className} {...props} />;
}

export function RadioGroupItem({ className = "", ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return <RadioGroupPrimitive.Item data-slot="radio-group-item" className={`grid size-4 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text)] outline-none transition-colors hover:border-[var(--text-muted)] focus-visible:ring-2 focus-visible:ring-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--text)] ${className}`} {...props}><RadioGroupPrimitive.Indicator className="grid size-full place-items-center"><span className="size-2 rounded-full bg-current" /></RadioGroupPrimitive.Indicator></RadioGroupPrimitive.Item>;
}
