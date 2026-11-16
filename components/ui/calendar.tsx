"use client";

import type { ComponentProps } from "react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./calendar.module.css";

/** shadcn Calendar composition, styled with the application's theme tokens. */
function Calendar({ className, classNames, showOutsideDays = true, components, ...props }: ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();
  const names = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, cn(value, styles[key])])) as typeof defaults;
  return <DayPicker data-slot="calendar" showOutsideDays={showOutsideDays} className={cn(styles.calendar, className)} classNames={{ ...names, ...classNames }} components={{
    Chevron: ({ orientation, className }) => orientation === "down" || orientation === "up"
      ? <ChevronDownIcon size={14} aria-hidden="true" className={cn(className, orientation === "up" && styles.reverse)} />
      : <ChevronRightIcon size={14} aria-hidden="true" className={cn(className, orientation === "left" && styles.reverse)} />,
    ...components,
  }} {...props} />;
}
export { Calendar };
