"use client";

import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function LabelTooltip({ content, children, disabled = false, side = "top", contentClassName }: {
  content: string;
  children: ReactElement;
  disabled?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  contentClassName?: string;
}) {
  return (
    <Tooltip disabled={disabled}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className={cn("break-all", contentClassName)}>{content}</TooltipContent>
    </Tooltip>
  );
}
