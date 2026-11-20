import { isDesktopBrowserHost } from "../../workspace/platform/native-browser";
import { MAX_SAVE_BYTES, saveFileAs } from "./save-file";

/** File bodies bypass Blob/Base64 IPC; the OS/user chooses the destination. */
export async function saveArtifactAs(name: string, endpoint: string, isCurrent: () => boolean) {
  if (!isCurrent()) return false;
  if (isDesktopBrowserHost()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try { return await invoke<boolean>("desktop_save_artifact", { filename: name, url: new URL(endpoint, window.location.origin).href }); }
    catch (error) {
      if (/desktop_save_artifact.*(?:not found|not allowed)|unknown command/i.test(String(error))) {
        // Preserve existing small/text downloads on older desktop installations.
        return saveFileAs(name, async () => {
          const response = await fetch(endpoint, { cache: "no-store" }), length = Number(response.headers.get("content-length"));
          if (!response.ok || !response.headers.has("content-length") || !Number.isSafeInteger(length) || length < 0 || length > MAX_SAVE_BYTES) { await response.body?.cancel(); throw new Error("请更新桌面程序后保存大文件产物。"); }
          return response.blob();
        }, isCurrent);
      }
      throw new Error(typeof error === "string" ? error : "文件产物保存失败。");
    }
  }
  const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<{ write: (bytes: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }> }> }).showSaveFilePicker;
  if (!picker) throw new Error("当前浏览器不支持选择保存路径，请使用 Eureka 桌面程序。");
  try {
    const handle = await picker.call(window, { suggestedName: name }); if (!isCurrent()) return false;
    const response = await fetch(endpoint, { cache: "no-store" }); if (!response.ok || !response.body) throw new Error("文件产物读取失败，请刷新运行记录后重试。");
    const reader = response.body.getReader(), writer = await handle.createWritable();
    try { for (;;) { if (!isCurrent()) throw new DOMException("已取消", "AbortError"); const { value, done } = await reader.read(); if (done) break; await writer.write(value); } await writer.close(); return true; }
    catch (error) { await reader.cancel().catch(() => {}); await writer.abort().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  } catch (error) { if (error instanceof Error && error.name === "AbortError") return false; throw error; }
}
