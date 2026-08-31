import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn("h-10 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-transparent px-3 text-sm outline-none placeholder:text-[var(--text-muted)] focus-visible:border-[var(--accent)]", className)} {...props} />;
});
Input.displayName = "Input";
export { Input };
