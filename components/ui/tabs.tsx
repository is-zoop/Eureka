"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = { value: string; onValueChange: (value: string) => void };
const TabsContext = createContext<TabsContextValue | null>(null);

function Tabs({ value, defaultValue, onValueChange, className, children, ...props }: ComponentProps<"div"> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void }) {
  const activeValue = value ?? defaultValue ?? "";
  return <TabsContext.Provider value={{ value: activeValue, onValueChange: onValueChange ?? (() => {}) }}><div className={cn("min-w-0", className)} {...props}>{children}</div></TabsContext.Provider>;
}

function TabsList({ className, ...props }: ComponentProps<"div">) {
  return <div role="tablist" className={cn("inline-flex h-9 items-center gap-1 rounded-[var(--radius-control)] bg-[var(--bg-hover)] p-1", className)} {...props} />;
}

function TabsTrigger({ value, className, children, onClick, ...props }: ComponentProps<"button"> & { value: string; children: ReactNode }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error("TabsTrigger must be used within Tabs");
  const active = context.value === value;
  return <button type="button" role="tab" aria-selected={active} data-state={active ? "active" : "inactive"} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) context.onValueChange(value); }} className={cn("inline-flex h-7 items-center justify-center whitespace-nowrap rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] data-[state=active]:bg-[var(--bg-panel)] data-[state=active]:text-[var(--text)] data-[state=active]:shadow-sm", className)} {...props}>{children}</button>;
}

function TabsContent({ value, className, children, ...props }: ComponentProps<"div"> & { value: string; children: ReactNode }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error("TabsContent must be used within Tabs");
  if (context.value !== value) return null;
  return <div role="tabpanel" className={className} {...props}>{children}</div>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
