import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type CheckboxProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  checked?: boolean;
  disabled?: boolean;
};

function Checkbox({ checked = false, disabled = false, className, ...props }: CheckboxProps) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-readonly="true"
      tabIndex={-1}
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "inline-grid size-4 shrink-0 place-items-center rounded-[4px] border shadow-xs transition-colors",
        checked
          ? "border-[var(--text)] bg-[var(--text)] text-[var(--bg-panel)]"
          : "border-[var(--border)] bg-[var(--bg-panel)] text-transparent",
        disabled ? "cursor-default" : "cursor-pointer",
        className,
      )}
      {...props}
    >
      {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
    </span>
  );
}

export { Checkbox };
