"use client";

import { CheckIcon } from "lucide-react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { cn } from "@/lib/utils";

const Combobox = ComboboxPrimitive.Root;

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return <ComboboxPrimitive.Input data-slot="combobox-input" className={cn("flex h-8 w-full rounded-[5px] border border-[var(--border)] bg-[var(--bg-panel)] px-2 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]", className)} {...props} />;
}

function ComboboxContent({ className, side = "bottom", sideOffset = 4, align = "start", ...props }: ComboboxPrimitive.Popup.Props & Pick<ComboboxPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return <ComboboxPrimitive.Portal><ComboboxPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="z-[1200]"><ComboboxPrimitive.Popup data-slot="combobox-content" className={cn("w-[var(--anchor-width)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-panel)] p-1 shadow-md outline-none", className)} {...props} /></ComboboxPrimitive.Positioner></ComboboxPrimitive.Portal>;
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={cn("max-h-56 overflow-y-auto", className)} {...props} />;
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return <ComboboxPrimitive.Item data-slot="combobox-item" className={cn("flex cursor-default items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 text-xs text-[var(--text)] outline-none data-[highlighted]:bg-[var(--bg-hover)] data-[selected]:bg-[var(--bg-selected)]", className)} {...props}><span>{children}</span><ComboboxPrimitive.ItemIndicator><CheckIcon className="size-3.5 shrink-0 text-[var(--accent)]" /></ComboboxPrimitive.ItemIndicator></ComboboxPrimitive.Item>;
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return <ComboboxPrimitive.Empty data-slot="combobox-empty" className={cn("px-2 py-4 text-center text-xs text-[var(--text-muted)]", className)} {...props} />;
}

export { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList };
