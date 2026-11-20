import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// shadcn Alert composition, using the application's existing theme tokens.
function Alert({ className, variant = "default", ...props }: ComponentProps<"div"> & { variant?: "default" | "destructive" }) {
  return <div data-slot="alert" role="alert" className={cn("relative grid w-full grid-cols-[var(--alert-icon-width,0px)_minmax(0,1fr)_fit-content(40%)] items-start gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] has-[>svg]:[--alert-icon-width:28px] [&>svg]:size-4 [&>svg]:translate-y-0.5", variant === "destructive" && "text-red-600 dark:text-red-400", className)} {...props} />;
}
function AlertTitle({ className, ...props }: ComponentProps<"div">) { return <div data-slot="alert-title" className={cn("col-start-2 font-semibold leading-5 [overflow-wrap:anywhere]", className)} {...props} />; }
function AlertDescription({ className, ...props }: ComponentProps<"div">) { return <div data-slot="alert-description" className={cn("col-start-2 whitespace-pre-wrap break-words text-sm leading-5 [overflow-wrap:anywhere]", className)} {...props} />; }
function AlertAction({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-action" className={cn("col-start-3 row-start-1 ms-3 flex min-w-0 items-start justify-end gap-1", className)} {...props} />;
}
export { Alert, AlertTitle, AlertDescription, AlertAction };
