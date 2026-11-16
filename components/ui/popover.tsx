"use client";

import type { ComponentProps } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root {...props} />;
}
function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}
function PopoverContent({ className, align = "center", alignOffset = 0, side = "bottom", sideOffset = 4, ...props }: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Positioner align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} style={{ zIndex: 1400 }}>
      <PopoverPrimitive.Popup data-slot="popover-content" className={cn("w-72 max-w-[var(--available-width)] origin-[var(--transform-origin)] rounded-[var(--radius-popover)] border border-[var(--border)] bg-[var(--bg-panel)] p-4 text-[var(--text)] shadow-[var(--shadow-soft)] outline-none", className)} {...props} />
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>;
}
function PopoverHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="popover-header" className={cn("flex flex-col gap-1.5", className)} {...props} />;
}
function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={cn("text-sm font-medium", className)} {...props} />;
}
function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return <PopoverPrimitive.Description data-slot="popover-description" className={cn("text-sm text-[var(--text-muted)]", className)} {...props} />;
}
export { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription };
