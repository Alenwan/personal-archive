import type { AppEnv } from "../env";
import { createRepository } from "../repositories/factory";
import type { AppRepository } from "../repositories/types";
import { createDocumentStorage, type DocumentStorage } from "../storage/documentStorage";

const CLEANUP_INTERVAL_MS = 60_000;

export async function cleanupStoredDocuments(
  repo: AppRepository,
  storage: DocumentStorage,
  limit = 25
): Promise<number> {
  const jobs = await repo.listPendingStorageCleanupJobs(limit);
  let completed = 0;
  for (const candidate of jobs) {
    const job = await repo.claimStorageCleanupJob(candidate.cleanupJobId);
    if (!job?.leaseToken) continue;
    try {
      await storage.delete(job.objectKey);
      if (await repo.completeStorageCleanup(job.cleanupJobId, job.leaseToken)) completed += 1;
    } catch {
      await repo.failStorageCleanup(job.cleanupJobId, job.leaseToken).catch(() => undefined);
      console.error("Storage cleanup deferred.", { cleanupJobId: job.cleanupJobId, code: "object_delete_failed" });
    }
  }
  return completed;
}

export function startStorageCleanupWorker(env: AppEnv): void {
  const repo = createRepository(env);
  const storage = createDocumentStorage(env);
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupStoredDocuments(repo, storage);
    } catch {
      console.error("Storage cleanup worker failed.", { code: "cleanup_repository_unavailable" });
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
}
