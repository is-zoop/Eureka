export type DesktopEditCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "select-all";
export type DesktopEditTarget = { element: HTMLElement | null; range: Range | null; start: number | null; end: number | null; text: string; editable: boolean };

function isTextInput(element: HTMLElement | null): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && element.selectionStart !== null);
}

export function captureDesktopEditTarget(doc: Document): DesktopEditTarget {
  const element = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const selection = doc.getSelection();
  const input = isTextInput(element) ? element : null;
  const editable = input ? !input.disabled && !input.readOnly : Boolean(element?.isContentEditable);
  const start = input?.selectionStart ?? null;
  const end = input?.selectionEnd ?? null;
  return {
    element,
    start,
    end,
    editable,
    text: input && start !== null && end !== null ? (input instanceof HTMLInputElement && input.type === "password" ? "" : input.value.slice(start, end)) : selection?.toString() ?? "",
    range: selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null,
  };
}

export function restoreDesktopEditTarget(target: DesktopEditTarget, doc: Document) {
  if (target.element?.isConnected) {
    target.element.focus({ preventScroll: true });
    if (isTextInput(target.element) && target.start !== null && target.end !== null) {
      target.element.setSelectionRange(target.start, target.end);
      return;
    }
  }
  if (target.range?.commonAncestorContainer.isConnected) {
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(target.range);
  }
}

export async function executeDesktopEdit(command: DesktopEditCommand, target: DesktopEditTarget, doc: Document) {
  if (["undo", "redo", "cut", "paste"].includes(command) && (!target.editable || !target.element?.isConnected)) return;
  restoreDesktopEditTarget(target, doc);
  if (command === "select-all" && (!target.element || target.element === doc.body)) {
    doc.getSelection()?.selectAllChildren(doc.querySelector(".eureka-desktop-content") ?? doc.body);
    return;
  }
  if (command !== "paste") {
    // Native editing preserves the input's undo stack and dispatches real input
    // events, including for controlled React fields and contenteditable composers.
    const nativeCommand = command === "select-all" ? "selectAll" : command;
    const done = doc.execCommand(nativeCommand);
    if (!done && command === "copy" && target.text) await navigator.clipboard.writeText(target.text);
    return;
  }
  if (!target.editable || !target.element?.isConnected) return;
  if (target.element.matches?.("[data-composer-attachments]")) {
    const detail: { handled?: Promise<boolean> } = {};
    target.element.dispatchEvent(new CustomEvent("eureka:paste-attachments", { detail }));
    if (await detail.handled) return;
  }
  const text = await navigator.clipboard.readText();
  if (!target.element.isConnected) return;
  restoreDesktopEditTarget(target, doc);
  if (doc.execCommand("insertText", false, text)) return;
  if (!isTextInput(target.element) || target.start === null || target.end === null) {
    throw new Error("Paste is unavailable in this input.");
  }
  const element = target.element;
  const next = element.value.slice(0, target.start) + text + element.value.slice(target.end);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, next);
  element.setSelectionRange(target.start + text.length, target.start + text.length);
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
}
