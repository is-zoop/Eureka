"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root
    data-slot="switch"
    className={cn("inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-[var(--border)] p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[#93c5fd] dark:border-[#575757] dark:bg-[#4a4a4a] dark:data-[state=checked]:bg-[#60a5fa]", className)}
    {...props}
  ><SwitchPrimitive.Thumb data-slot="switch-thumb" className="block h-4 w-4 rounded-full bg-[var(--bg-panel)] shadow-sm transition-transform dark:bg-[#f5f5f5] data-[state=checked]:translate-x-4" /></SwitchPrimitive.Root>;
}

export { Switch };
