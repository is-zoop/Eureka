import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: ComponentProps<"section">) { return <section className={cn("rounded-[var(--radius-popover)] border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text)] shadow-[var(--shadow-soft)]", className)} {...props} />; }
function CardHeader({ className, ...props }: ComponentProps<"div">) { return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />; }
function CardTitle({ className, ...props }: ComponentProps<"h2">) { return <h2 className={cn("text-lg font-semibold tracking-[-0.01em]", className)} {...props} />; }
function CardDescription({ className, ...props }: ComponentProps<"p">) { return <p className={cn("text-sm text-[var(--text-muted)]", className)} {...props} />; }
function CardAction({ className, ...props }: ComponentProps<"div">) { return <div className={cn("absolute right-6 top-6", className)} {...props} />; }
function CardContent({ className, ...props }: ComponentProps<"div">) { return <div className={cn("px-6", className)} {...props} />; }
function CardFooter({ className, ...props }: ComponentProps<"div">) { return <div className={cn("flex items-center p-6", className)} {...props} />; }
export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
