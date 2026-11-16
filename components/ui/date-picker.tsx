"use client";

import { useState, type ComponentProps } from "react";
import { format, isValid, parse } from "date-fns";
import { enUS } from "react-day-picker/locale/en-US";
import { zhCN } from "react-day-picker/locale/zh-CN";
import { CalendarIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parse(value, "yyyy-MM-dd", new Date());
  return isValid(date) && format(date, "yyyy-MM-dd") === value ? date : undefined;
}

/** shadcn's input Date Picker: Popover + Calendar, with a stable date-only value. */
function DatePicker({ value, onValueChange, calendarLabel, className, disabled, readOnly, ...props }: Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange"> & { value: string; onValueChange: (value: string) => void; calendarLabel: string }) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = parseDate(value);
  const [month, setMonth] = useState(() => selected ?? new Date());
  return <Popover open={open && !disabled && !readOnly} onOpenChange={next => { setOpen(next); if (next) setMonth(selected ?? new Date()); }}>
    <div data-slot="date-picker" className="relative min-w-0">
      <Input {...props} type="text" disabled={disabled} readOnly={readOnly} value={value} placeholder="yyyy-mm-dd" inputMode="numeric" maxLength={10} pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" className={cn("pr-10", className)} onChange={event => { onValueChange(event.target.value); const date = parseDate(event.target.value); if (date) setMonth(date); }} />
      <PopoverTrigger disabled={disabled || readOnly} aria-label={calendarLabel} render={<Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-[var(--text-muted)]" />}><CalendarIcon size={15} aria-hidden="true" /></PopoverTrigger>
    </div>
    <PopoverContent align="end" aria-label={calendarLabel} className="w-auto p-0">
      <Calendar mode="single" autoFocus locale={locale === "zh-CN" ? zhCN : enUS} selected={selected} month={month} onMonthChange={setMonth} captionLayout="dropdown" startMonth={new Date((selected ?? new Date()).getFullYear() - 100, 0)} endMonth={new Date((selected ?? new Date()).getFullYear() + 100, 11)} onSelect={date => { onValueChange(date ? format(date, "yyyy-MM-dd") : ""); setOpen(false); }} />
    </PopoverContent>
  </Popover>;
}
export { DatePicker };
