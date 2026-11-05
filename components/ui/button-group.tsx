"use client";

import type { ComponentProps } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@/lib/utils";
import { Separator } from "./separator";

// shadcn Base UI composition, using Eureka's existing Button and theme tokens.
// https://ui.shadcn.com/docs/components/base/button-group
function ButtonGroup({ className, orientation = "horizontal", ...props }: ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return <div
    role="group"
    data-slot="button-group"
    data-orientation={orientation}
    className={cn(
      "flex w-fit items-stretch [&>*:focus-visible]:relative [&>*:focus-visible]:z-10 [&>input]:flex-1",
      // Menu triggers insert focus guards while open. Only styled controls count
      // as group siblings; the guards must not change the outer corners.
      orientation === "horizontal"
        ? "[&>[data-slot]:has(~[data-slot])]:rounded-r-none [&>[data-slot]~[data-slot]]:rounded-l-none [&>[data-slot]~[data-slot]]:border-l-0"
        : "flex-col [&>[data-slot]:has(~[data-slot])]:rounded-b-none [&>[data-slot]~[data-slot]]:rounded-t-none [&>[data-slot]~[data-slot]]:border-t-0",
      className,
    )}
    {...props}
  />;
}

function ButtonGroupText({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    state: { slot: "button-group-text" },
    props: mergeProps<"div">({ className: cn("flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-hover)] px-3 text-sm text-[var(--text-muted)] [&_svg]:pointer-events-none [&_svg]:shrink-0", className) }, props),
  });
}

function ButtonGroupSeparator({ className, orientation = "vertical", ...props }: ComponentProps<typeof Separator>) {
  return <Separator
    data-slot="button-group-separator"
    aria-hidden="true"
    orientation={orientation}
    className={cn("relative self-stretch", orientation === "vertical" ? "h-auto w-px" : "h-px w-auto", className)}
    {...props}
  />;
}

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText };
