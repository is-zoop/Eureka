export type NoticeType = "info" | "success" | "warning" | "error";
export type NotificationInput = { id?: string; type?: NoticeType; title?: string; message: string; action?: { label: string; onClick: () => void } };
export type NotificationItem = NotificationInput & { id: string; type: NoticeType };

// The store lives for this browser page, including navigation between routes.
export function createNotificationStore() {
  let items: NotificationItem[] = [];
  const seen = new Set<string>();
  const listeners = new Set<() => void>();
  let sequence = 0;
  const emit = () => listeners.forEach((listener) => listener());
  return {
    getSnapshot: () => items,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    notify(input: NotificationInput) {
      const id = input.id ?? `notification-${++sequence}`;
      if (!input.message.trim() || seen.has(id)) return id;
      seen.add(id);
      items = [{ ...input, id, type: input.type ?? "info" }, ...items];
      emit();
      return id;
    },
    dismiss(id: string) {
      items = items.filter((item) => item.id !== id);
      emit();
    },
  };
}

export const notificationStore = createNotificationStore();
export const notify = notificationStore.notify;
export const dismiss = notificationStore.dismiss;
