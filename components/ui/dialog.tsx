"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { useI18n } from "@/hooks/useI18n";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  const { t } = useI18n();
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Backdrop data-native-browser-modal="true" className="fixed inset-0 z-[1300] bg-black/35 dark:bg-black/60 data-closed:hidden" />
    <DialogPrimitive.Popup data-slot="dialog-content" className={cn("fixed left-1/2 top-1/2 z-[1301] flex max-h-[min(85dvh,800px)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-popover)] border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text)] shadow-[var(--shadow-soft)] outline-none data-closed:hidden", className)} {...props}>
      {children}
      <DialogPrimitive.Close render={<Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label={t("chat.close")} />}><XIcon size={16} /></DialogPrimitive.Close>
    </DialogPrimitive.Popup>
  </DialogPrimitive.Portal>;
}
function DialogHeader({ className, ...props }: ComponentProps<"div">) { return <div className={cn("shrink-0 border-b border-[var(--border)] px-5 py-4 pr-14", className)} {...props} />; }
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) { return <DialogPrimitive.Title className={cn("text-base font-medium", className)} {...props} />; }
function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) { return <DialogPrimitive.Description className={cn("mt-1 text-sm text-[var(--text-muted)]", className)} {...props} />; }
function DialogBody({ className, ...props }: ComponentProps<"div">) { return <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", className)} {...props} />; }
function DialogFooter({ className, ...props }: ComponentProps<"div">) { return <div className={cn("flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-3", className)} {...props} />; }

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter };
