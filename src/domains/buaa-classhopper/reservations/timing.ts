export function retryDelay(attemptNumber: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attemptNumber - 1), 2 ** 31);
}
