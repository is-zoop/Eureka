export function reconnectDelay(attempt: number, random = Math.random): number {
  return Math.min(10_000, 250 * 2 ** attempt) * (0.9 + random() * 0.2);
}
