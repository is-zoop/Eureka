import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "link"; size?: "default" | "sm" };
function Button({ className, variant = "default", size = "default", ...props }: Props) {
  const variants = { default: "bg-[var(--text)] text-[var(--bg-panel)] hover:opacity-90", outline: "border border-[var(--border)] bg-transparent hover:bg-[var(--bg-hover)]", link: "bg-transparent text-[var(--text)] hover:underline" };
  return <button className={cn("inline-flex items-center justify-center rounded-[var(--radius-control)] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-50", size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm", variants[variant], className)} {...props} />;
}
export { Button };
