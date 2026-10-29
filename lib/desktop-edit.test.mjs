import assert from "node:assert/strict";
import test from "node:test";
import { captureDesktopEditTarget, executeDesktopEdit } from "./desktop-edit.ts";

test("editing restores the selected input and paste updates controlled fields", async () => {
  const names = ["HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "InputEvent", "navigator"];
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  class Element { isConnected = true; focus() { doc.activeElement = this; } }
  class Input extends Element {
    _value = "abcdef"; selectionStart = 1; selectionEnd = 4; type = "text"; events = [];
    get value() { return this._value; } set value(next) { this._value = next; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    dispatchEvent(event) { this.events.push(event); }
  }
  class Textarea extends Input { get value() { return this._value; } set value(next) { this._value = next; } }
  const calls = [];
  const input = new Textarea();
  const doc = { activeElement: input, getSelection: () => null, execCommand: (...args) => { calls.push({ args, active: doc.activeElement, start: input.selectionStart, end: input.selectionEnd }); return false; } };
  const clipboard = [];
  for (const [index, value] of [Element, Input, Textarea, class { constructor(type, options) { Object.assign(this, { type, ...options }); } }, { clipboard: { readText: async () => "XYZ", writeText: async (text) => clipboard.push(text) } }].entries()) Object.defineProperty(globalThis, names[index], { configurable: true, value });
  try {
    const target = captureDesktopEditTarget(doc);
    assert.equal(target.text, "bcd");
    doc.activeElement = new Element();
    input.setSelectionRange(0, 0);
    await executeDesktopEdit("undo", target, doc);
    assert.equal(calls.at(-1).active, input);
    assert.equal(calls.at(-1).start, 1);
    assert.equal(calls.at(-1).end, 4);
    await executeDesktopEdit("paste", target, doc);
    assert.equal(input.value, "aXYZef");
    assert.equal(input.selectionStart, 4);
    assert.equal(input.events.at(-1).inputType, "insertFromPaste");
    input.matches = (selector) => selector === "[data-composer-attachments]";
    input.dispatchEvent = (event) => {
      input.events.push(event);
      if (event.type === "eureka:paste-attachments") event.detail.handled = Promise.resolve(true);
    };
    const beforeFilePaste = input.value;
    const callsBeforeFilePaste = calls.length;
    await executeDesktopEdit("paste", target, doc);
    assert.equal(input.value, beforeFilePaste, "handled file paste must not insert clipboard text");
    assert.equal(calls.length, callsBeforeFilePaste);
    input.dispatchEvent = (event) => {
      input.events.push(event);
      if (event.type === "eureka:paste-attachments") event.detail.handled = Promise.resolve(false);
    };
    input.value = "abcdef";
    await executeDesktopEdit("paste", target, doc);
    assert.equal(input.value, "aXYZef", "plain text still pastes when no files are present");
    await executeDesktopEdit("copy", target, doc);
    assert.deepEqual(clipboard, ["bcd"]);
    const password = new Input(); password.type = "password"; doc.activeElement = password;
    assert.equal(captureDesktopEditTarget(doc).text, "");
    input.isConnected = false;
    const count = calls.length;
    await executeDesktopEdit("paste", target, doc);
    await executeDesktopEdit("cut", { ...target, editable: false }, doc);
    assert.equal(calls.length, count);
  } finally {
    names.forEach((name, index) => { if (originals[index]) Object.defineProperty(globalThis, name, originals[index]); else delete globalThis[name]; });
  }
});
