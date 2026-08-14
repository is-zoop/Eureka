export const bottomThreshold = 48;
export type ScrollTarget = { scrollHeight: number; scrollTop: number; clientHeight: number };

export function isAtLatest(target: ScrollTarget): boolean {
  return target.scrollHeight - target.scrollTop - target.clientHeight < bottomThreshold;
}

export function scrollToLatest(target: Pick<ScrollTarget, "scrollHeight" | "scrollTop">): void {
  target.scrollTop = target.scrollHeight;
}
