"use client";

import { useRef, useState, type ComponentProps } from "react";
import { PencilIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

/** Inline text editing composed from the shared shadcn controls. */
export function EditLine({ value, onValueChange, className, ...props }: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & { value: string; onValueChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const original = useRef(value);
  if (editing && !props.disabled) return <Input {...props} autoFocus value={value} className={className} onChange={event => onValueChange(event.target.value)} onBlur={() => setEditing(false)} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); setEditing(false); }
    if (event.key === "Escape") { event.preventDefault(); onValueChange(original.current); setEditing(false); }
  }} />;
  return <Button type="button" id={props.id} variant="ghost" disabled={props.disabled} aria-label={props["aria-label"]} className={cn("group h-8 w-full min-w-0 justify-start gap-2 px-2 text-left font-normal", className)} onClick={() => { original.current = value; setEditing(true); }}>
    <span className="min-w-0 flex-1 truncate">{value || props.placeholder}</span><PencilIcon size={13} className="shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
  </Button>;
}
