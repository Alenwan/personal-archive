import type { DocumentStorage } from "../storage/documentStorage";

export async function probeStorage(storage: DocumentStorage): Promise<void> {
  const key = `__personal_archive_probe__/${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const signal = AbortSignal.timeout(5_000);
  try {
    await storage.put(key, bytes.buffer, "application/octet-stream", signal);
    const stored = await storage.get(key, signal);
    if (!stored) throw new Error("Storage probe could not read its object.");
    const actual = new Uint8Array(await new Response(stored.body).arrayBuffer());
    if (actual.length !== bytes.length || !actual.every((value, index) => value === bytes[index])) throw new Error("Storage probe content did not match.");
  } finally {
    // Delete only this run's generated object, even after an ambiguous PUT.
    await storage.delete(key, AbortSignal.timeout(5_000));
  }
  if (await storage.get(key, AbortSignal.timeout(5_000))) throw new Error("Storage probe deletion did not take effect.");
}

export function createReadinessCheck(schema: () => Promise<void>, stores: DocumentStorage[], now = Date.now) {
  let lastStorageSuccess: number | null = null;
  let inFlight: Promise<void> | null = null;
  return async () => {
    // Every check verifies schema. Writes are coalesced and at most once a
    // minute after success; failed probes never receive a healthy cache entry.
    if (!inFlight) {
      inFlight = (async () => {
        await schema();
        if (lastStorageSuccess === null || now() - lastStorageSuccess >= 60_000) {
          // Startup may exit after rejection. Wait for every probe's cleanup
          // even when a different store has already failed.
          const results = await Promise.allSettled(stores.map(probeStorage));
          const failure = results.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          lastStorageSuccess = now();
        }
      })().finally(() => { inFlight = null; });
    }
    return inFlight;
  };
}
