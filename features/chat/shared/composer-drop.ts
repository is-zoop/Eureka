export type NativeFileDrop = { type: "enter" | "over" | "drop"; position: { x: number; y: number }; paths?: string[] } | { type: "leave" };
export function containsPhysicalDrop(rect: { left: number; right: number; top: number; bottom: number; width: number; height: number }, point: { x: number; y: number }, scale: number) {
  const x = point.x / scale, y = point.y / scale;
  return rect.width > 0 && rect.height > 0 && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}
/** Cleanup also covers a component unmounting before the native listener is ready. */
export function bindNativeFileDrop(subscribe: (handler: (event: { payload: NativeFileDrop }) => void) => Promise<() => void>, options: {
  contains: (position: { x: number; y: number }) => boolean; hover: (active: boolean) => void; drop: (paths: string[]) => void;
}) {
  let disposed = false, unlisten: (() => void) | undefined;
  void subscribe(({ payload }) => {
    if (disposed) return;
    if (payload.type === "leave") { options.hover(false); return; }
    const inside = options.contains(payload.position);
    options.hover(payload.type !== "drop" && inside);
    if (payload.type === "drop" && inside && payload.paths?.length) options.drop(payload.paths);
  }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => { if (!disposed) options.hover(false); });
  return () => { disposed = true; unlisten?.(); };
}
