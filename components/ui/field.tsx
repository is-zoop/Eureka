import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";
import { Separator } from "./separator";

function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset data-slot="field-set" className={cn("flex min-w-0 flex-col gap-6", className)} {...props} />;
}
function FieldLegend({ className, variant = "legend", ...props }: ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return <legend data-slot="field-legend" data-variant={variant} className={cn("mb-3 font-medium", variant === "legend" ? "text-base" : "text-sm", className)} {...props} />;
}
function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("@container/field-group flex w-full flex-col gap-6", className)} {...props} />;
}
function Field({ className, orientation = "vertical", ...props }: ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" | "responsive" }) {
  return <div role="group" data-slot="field" data-orientation={orientation} className={cn("group/field flex w-full gap-2 data-[invalid=true]:text-[var(--danger)]", orientation === "vertical" ? "flex-col" : orientation === "horizontal" ? "flex-row items-center gap-3 [&>[data-slot=field-label]]:flex-1" : "flex-col @md/field-group:flex-row @md/field-group:items-center @md/field-group:gap-3", className)} {...props} />;
}
function FieldContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-content" className={cn("flex flex-1 flex-col gap-1.5", className)} {...props} />;
}
function FieldLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={cn("flex w-fit items-center gap-2 leading-snug group-data-[disabled=true]/field:opacity-50", className)} {...props} />;
}
function FieldTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-title" className={cn("flex w-fit items-center gap-2 text-sm font-medium leading-snug", className)} {...props} />;
}
function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("text-sm leading-normal text-[var(--text-muted)]", className)} {...props} />;
}
function FieldSeparator({ className, children, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-separator" className={cn("relative -my-2 h-5 text-sm", className)} {...props}><Separator className="absolute inset-x-0 top-1/2" />{children && <span className="relative mx-auto block w-fit bg-[var(--bg-panel)] px-2 text-[var(--text-muted)]">{children}</span>}</div>;
}
function FieldError({ className, children, errors, ...props }: ComponentProps<"div"> & { errors?: ({ message?: string } | undefined)[] }) {
  const messages = [...new Set(errors?.map(error => error?.message).filter((message): message is string => Boolean(message)))];
  const content = children ?? (messages.length > 1 ? <ul className="ml-4 list-disc space-y-1">{messages.map(message => <li key={message}>{message}</li>)}</ul> : messages[0]);
  if (!content) return null;
  return <div role="alert" data-slot="field-error" className={cn("text-sm text-[var(--danger)]", className)} {...props}>{content}</div>;
}

export { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle };
