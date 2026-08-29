"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Minimal official shadcn Sidebar composition primitives used by Eureka's
 * existing custom-resizable sidebar. */
function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cn("mt-auto shrink-0 border-t border-[var(--border)] p-2", className)} {...props} />;
}

function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cn("m-0 flex list-none flex-col gap-1 p-0", className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn("relative", className)} {...props} />;
}

function SidebarMenuButton({ className, ...props }: ComponentProps<"button">) {
  return <button data-slot="sidebar-menu-button" className={cn("flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-left text-sm text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]", className)} {...props} />;
}

export { SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton };
