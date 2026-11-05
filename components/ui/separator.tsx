"use client";

import type { ComponentProps } from "react";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "@/lib/utils";

function Separator({ className, orientation = "horizontal", ...props }: Omit<ComponentProps<typeof SeparatorPrimitive>, "className"> & { className?: string }) {
  return <SeparatorPrimitive
    data-slot="separator"
    orientation={orientation}
    className={cn("shrink-0 bg-[var(--border)]", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
    {...props}
  />;
}

export { Separator };
