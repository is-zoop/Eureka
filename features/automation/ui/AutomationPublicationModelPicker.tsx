"use client";
import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { useI18n } from "@/hooks/useI18n";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import styles from "../../chat/ui/ComposerSelectors.module.css";

export function AutomationPublicationModelPicker({ items, value, disabled, onChange, id = "publication-ai-model", label, fullWidth = false }: {
  items: { value: string; name: string; provider: string; modelId: string }[];
  value: string; disabled: boolean; onChange: (value: string) => void;
  id?: string;
  label?: string;
  fullWidth?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [filter, setFilter] = useState("");
  const selected = items.find(item => item.value === value);
  const groups = new Map<string, typeof items>();
  for (const item of items) if (`${item.name} ${item.provider} ${item.modelId}`.toLowerCase().includes(filter.trim().toLowerCase())) groups.set(item.provider, [...groups.get(item.provider) ?? [], item]);
  return <Popover.Root open={open} onOpenChange={next => { setOpen(next); if (!next) setFilter(""); }}>
    <Popover.Trigger id={id} aria-label={label ?? t("automationSettings.aiModel")} disabled={disabled} className={`${styles.trigger} ${styles.modelTrigger}`} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-control)", ...(fullWidth ? { width: "100%", maxWidth: "100%", height: "2.5rem", justifyContent: "space-between", fontSize: "0.875rem", fontWeight: 400, paddingInline: "0.75rem" } : {}) }}>
      <span className={styles.name}>{selected?.name ?? t("chat.selectModel")}</span><ChevronDownIcon size={13}/>
    </Popover.Trigger>
    <Popover.Portal><Popover.Positioner side="bottom" align="start" sideOffset={fullWidth ? 4 : 6} collisionPadding={8} collisionAvoidance={fullWidth ? { side: "none", align: "shift", fallbackAxisSide: "none" } : undefined} style={{ zIndex: 1400 }}>
      <Popover.Popup className={styles.modelPopup} style={fullWidth ? { width: "var(--anchor-width)", maxWidth: "var(--available-width)", borderRadius: "var(--radius-popover)" } : undefined} aria-label={t("chat.filterModels")}>
        <Command shouldFilter={false} className="rounded-none bg-transparent text-[var(--text)]" style={{ flex: 1, minHeight: 0 }}>
          <CommandInput className="min-w-0" value={filter} onValueChange={setFilter} placeholder={t("chat.filterModels")} aria-label={t("chat.filterModels")} autoComplete="off" spellCheck={false} style={{ fontSize: 12, color: "var(--text)" }}/>
          <CommandList style={{ flex: 1, minHeight: 0, maxHeight: "none" }}>
            {!groups.size && <CommandEmpty style={{ display: "block" }}>{t("chat.noMatchingModels")}</CommandEmpty>}
            {[...groups].map(([provider, options]) => <CommandGroup key={provider} heading={provider} className={styles.modelGroup}>{options.map(item => <CommandItem key={item.value} value={`${item.provider}/${item.modelId} ${item.name}`} data-current={value === item.value} className={styles.modelItem} onSelect={() => { setOpen(false); setFilter(""); onChange(item.value); }}><span className={styles.name}>{item.name}</span></CommandItem>)}</CommandGroup>)}
          </CommandList>
        </Command>
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
