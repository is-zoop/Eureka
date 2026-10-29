import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} data-slot="textarea" className={cn(
    "flex min-h-24 w-full min-w-0 resize-y rounded-[var(--radius-control)] border border-[var(--border)] bg-transparent px-3 py-2.5 text-sm leading-6 text-[var(--text)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--text-placeholder)] focus-visible:border-[color-mix(in_srgb,var(--text-muted)_55%,var(--border))] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text)_8%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--danger)]",
    className,
  )} {...props} />;
});
Textarea.displayName = "Textarea";

export { Textarea };
