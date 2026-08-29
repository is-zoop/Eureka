import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cn("h-10 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-transparent px-3 text-sm outline-none placeholder:text-[var(--text-muted)] focus-visible:border-[var(--accent)]", className)} {...props} />; }
export { Input };
