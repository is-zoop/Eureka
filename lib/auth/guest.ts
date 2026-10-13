/** A local-use preference, never an OAuth identity or enterprise credential. */
export const GUEST_SESSION_COOKIE = "eureka_guest_session";
export const GUEST_SESSION_MAX_AGE = 60 * 60 * 24 * 365;
export const GUEST_NAME = "不愿意透露姓名的神秘用户";
export const GUEST_AVATAR_URL = "/icons/guest-avatar.png";

export function isGuestSessionValue(value: string | undefined): boolean {
  return value === "1";
}

export function guestReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/";
  try {
    const target = new URL(value, "http://eureka.local");
    const pathname = decodeURIComponent(target.pathname);
    if (target.origin !== "http://eureka.local" || pathname.includes("\\")
      || /^\/(?:login|marketplace|api)(?:\/|$)/i.test(pathname)) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
