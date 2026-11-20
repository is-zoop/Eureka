"use client";

import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function LabelTooltip({ content, children, disabled = false, side = "top", contentClassName, container }: {
  content?: string | null;
  children: ReactElement;
  disabled?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  contentClassName?: string;
  container?: ComponentProps<typeof TooltipContent>["container"];
}) {
  return (
    <Tooltip disabled={disabled || !content}>
      <TooltipTrigger render={children} />
      {content && <TooltipContent container={container} side={side} className={cn("break-all", contentClassName)}>{content}</TooltipContent>}
    </Tooltip>
  );
}
