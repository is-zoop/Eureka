import { isDesktopBrowserHost } from "./native-browser";

export const MAX_SAVE_BYTES = 32 * 1024 * 1024;
export function saveFilePayload(name: string, bytes: Uint8Array): Uint8Array {
  const filename = new TextEncoder().encode(name);
  if (!filename.length || filename.length > 1024 || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name)) throw new Error("保存文件名无效。");
  if (bytes.byteLength > MAX_SAVE_BYTES) throw new Error("文件超过本次保存支持的大小。");
  const payload = new Uint8Array(4 + filename.length + bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, filename.length);
  payload.set(filename, 4); payload.set(bytes, 4 + filename.length);
  return payload;
}

interface SaveHandle {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }>;
}
type PickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle> };

/** Every write is preceded by the user's Save As choice. Cancellation stays silent. */
export async function saveFileAs(name: string, load: () => Promise<Blob>, isCurrent = () => true): Promise<boolean> {
  if (!isCurrent()) return false;
  if (isDesktopBrowserHost()) {
    const blob = await load();
    if (!isCurrent()) return false;
    if (blob.size > MAX_SAVE_BYTES) throw new Error("文件超过本次保存支持的大小。");
    const payload = saveFilePayload(name, new Uint8Array(await blob.arrayBuffer()));
    if (!isCurrent()) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    try { return await invoke<boolean>("desktop_save_file", payload); }
    catch (error) {
      if (typeof error === "string" && /desktop_save_file.*(?:not found|not allowed)|unknown command/i.test(error)) throw new Error("请更新桌面程序后再选择保存路径。");
      throw error instanceof Error ? error : new Error(typeof error === "string" ? error : "文件保存失败。");
    }
  }
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (!picker) throw new Error("当前浏览器不支持选择保存路径，请使用 Eureka 桌面程序。");
  try {
    // Called before fetching so a regular browser retains the click's user activation.
    const handle = await picker.call(window, { suggestedName: name });
    if (!isCurrent()) return false;
    const blob = await load();
    if (!isCurrent()) return false;
    const writer = await handle.createWritable();
    try { await writer.write(blob); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return false;
    throw error;
  }
}
