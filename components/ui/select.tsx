"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
type StyledProps<Props> = Omit<Props, "className"> & { className?: string };

function SelectValue({ className, ...props }: StyledProps<SelectPrimitive.Value.Props>) {
  return <SelectPrimitive.Value data-slot="select-value" className={cn("min-w-0 flex-1 truncate text-left", className)} {...props} />;
}

function SelectTrigger({ className, children, ...props }: StyledProps<SelectPrimitive.Trigger.Props>) {
  return <SelectPrimitive.Trigger data-slot="select-trigger" className={cn(
    "inline-flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-transparent px-3 text-sm text-[var(--text)] outline-none focus-visible:outline-1 focus-visible:outline-[var(--border)] disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )} {...props}>{children}<SelectPrimitive.Icon><ChevronDownIcon size={15} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" /></SelectPrimitive.Icon></SelectPrimitive.Trigger>;
}

function SelectContent({ className, children, side = "bottom", align = "start", sideOffset = 4, alignOffset = 0, ...props }: StyledProps<SelectPrimitive.Popup.Props> & Pick<SelectPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "alignOffset">) {
  return <SelectPrimitive.Portal>
    <SelectPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} alignOffset={alignOffset} alignItemWithTrigger={false} style={{ zIndex: 1400 }}>
      <SelectPrimitive.Popup data-slot="select-content" className={cn(
        "min-w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-hidden rounded-[var(--radius-popover)] border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text)] shadow-[var(--shadow-soft)] outline-none",
        className,
      )} {...props}><SelectPrimitive.List className="max-h-[min(320px,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none">{children}</SelectPrimitive.List></SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>;
}

function SelectItem({ className, children, ...props }: StyledProps<SelectPrimitive.Item.Props>) {
  return <SelectPrimitive.Item data-slot="select-item" className={cn(
    "relative flex min-w-0 cursor-default items-center rounded-[calc(var(--radius-control)-2px)] py-2 pl-3 pr-8 text-sm text-[var(--text)] outline-none data-highlighted:bg-[var(--bg-hover)] data-selected:bg-[var(--bg-selected)] data-disabled:pointer-events-none data-disabled:opacity-50",
    className,
  )} {...props}><SelectPrimitive.ItemText className="min-w-0 flex-1 break-words">{children}</SelectPrimitive.ItemText><SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center"><CheckIcon size={14} aria-hidden="true" /></SelectPrimitive.ItemIndicator></SelectPrimitive.Item>;
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
