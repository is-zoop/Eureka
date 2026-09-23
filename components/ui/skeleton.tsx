import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Theme-aware shadcn-style loading placeholder. */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("animate-pulse rounded-md bg-[var(--bg-hover)]", className)} {...props} />;
}

export { Skeleton };
