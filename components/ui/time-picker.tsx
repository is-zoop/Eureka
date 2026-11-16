"use client";

import type { ComponentProps } from "react";
import { ClockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

/** shadcn's Time Picker composition, keeping the scheduler's HH:mm value. */
function TimePicker({ value, onValueChange, className, ...props }: Omit<ComponentProps<typeof Input>, "type" | "step" | "value" | "onChange"> & { value: string; onValueChange: (value: string) => void }) {
  return <div data-slot="time-picker" className="relative min-w-0">
    <ClockIcon aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/>
    <Input {...props} type="time" step={60} value={value} onChange={event => onValueChange(event.target.value)} className={cn("appearance-none pl-9 tabular-nums [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none", className)}/>
  </div>;
}

export { TimePicker };
