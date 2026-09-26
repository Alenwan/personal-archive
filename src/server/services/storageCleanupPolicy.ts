export const STORAGE_CLEANUP_LEASE_MS = 5 * 60_000;
export const STORAGE_CLEANUP_REFERENCE_DELAY_MS = 60_000;

export function storageCleanupRetryDelay(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.min(6, Math.max(0, attempts - 1)));
}
