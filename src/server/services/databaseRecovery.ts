import type {
  DatabaseRecoveryStatus,
  DatabaseSnapshotCreateResult,
  DatabaseSnapshotListResult,
  DatabaseSnapshotSummary
} from "../../shared/types";
import type { AppEnv } from "../env";

const NEON_API_BASE_URL = "https://console.neon.tech/api/v2";
export const NEON_SNAPSHOT_LIMIT_MESSAGE =
  "This database has reached its restore point limit. Delete an existing restore point in the database admin console or upgrade the database plan before creating another restore point.";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(record: JsonRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bytesField(record: JsonRecord | null, key: string): number | null {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseNeonApiError(detail: string): { code: string | null; message: string | null } {
  const parsed = asRecord(JSON.parse(detail));
  return {
    code: stringField(parsed, "code"),
    message: stringField(parsed, "message")
  };
}

export function isNeonSnapshotLimitExceeded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("SNAPSHOTS_LIMIT_EXCEEDED") || message.toLowerCase().includes("snapshots limit exceeded");
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds <= 0) return "Disabled";
  const days = seconds / 86400;
  if (Number.isInteger(days) && days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = seconds / 3600;
  if (Number.isInteger(hours) && hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${seconds} seconds`;
}

function missingNeonEnv(env: AppEnv): string[] {
  return [
    env.NEON_API_KEY ? "" : "database recovery key",
    env.NEON_PROJECT_ID ? "" : "database project"
  ].filter(Boolean);
}

async function neonApi<T>(env: AppEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${NEON_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${env.NEON_API_KEY}`
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let parsedCode: string | null = null;
    let parsedMessage: string | null = null;
    try {
      const parsed = parseNeonApiError(detail);
      parsedCode = parsed.code;
      parsedMessage = parsed.message;
    } catch {
      parsedCode = null;
      parsedMessage = null;
    }
    const readableDetail = [parsedCode, parsedMessage].filter(Boolean).join(": ") || detail.slice(0, 180);
    throw new Error(`Database recovery service returned ${response.status}${readableDetail ? `: ${readableDetail}` : ""}`);
  }

  return response.json() as Promise<T>;
}

function pickBranch(branches: JsonRecord[], env: AppEnv, defaultBranchId: string | null): JsonRecord | null {
  const configuredBranchId = env.NEON_BRANCH_ID?.trim();
  const configuredBranchName = env.NEON_BRANCH_NAME?.trim();
  if (configuredBranchId) {
    const match = branches.find((branch) => stringField(branch, "id") === configuredBranchId);
    if (match) return match;
  }
  if (configuredBranchName) {
    const match = branches.find((branch) => stringField(branch, "name") === configuredBranchName);
    if (match) return match;
  }
  if (defaultBranchId) {
    const match = branches.find((branch) => stringField(branch, "id") === defaultBranchId);
    if (match) return match;
  }
  return branches.find((branch) => stringField(branch, "name") === "main") ?? branches[0] ?? null;
}

async function loadNeonProjectAndBranch(env: AppEnv) {
  const projectId = env.NEON_PROJECT_ID!;
  const projectPayload = await neonApi<JsonRecord>(env, `/projects/${encodeURIComponent(projectId)}`);
  const project = asRecord(projectPayload.project) ?? projectPayload;
  const defaultBranchId = stringField(project, "default_branch_id");
  const restoreWindowSeconds = numberField(project, "history_retention_seconds");

  const branchesPayload = await neonApi<JsonRecord>(env, `/projects/${encodeURIComponent(projectId)}/branches?limit=100`);
  const branches = asArray(branchesPayload.branches).map(asRecord).filter(Boolean) as JsonRecord[];
  const branch = pickBranch(branches, env, defaultBranchId);
  const branchId = stringField(branch, "id");

  if (!branch || !branchId) {
    throw new Error("No matching database branch was found for this project.");
  }

  return {
    projectId,
    project,
    branch,
    branchId,
    defaultBranchId,
    restoreWindowSeconds
  };
}

function baseStatus(env: AppEnv): DatabaseRecoveryStatus {
  return {
    provider: env.HYPERDRIVE?.connectionString ? "managed-database" : "memory-demo",
    configured: false,
    connected: false,
    source: "local-config",
    checkedAt: new Date().toISOString(),
    message: "Database recovery status is not connected.",
    missingEnv: missingNeonEnv(env),
    error: null
  };
}

function mapSnapshot(snapshot: JsonRecord, branch: JsonRecord | null): DatabaseSnapshotSummary | null {
  const snapshotId = stringField(snapshot, "id");
  if (!snapshotId) return null;

  const branchId = stringField(snapshot, "branch_id") ?? stringField(snapshot, "source_branch_id");
  const configuredBranchId = stringField(branch, "id");
  const branchName = branchId && branchId === configuredBranchId ? stringField(branch, "name") : null;

  return {
    snapshotId,
    snapshotName: stringField(snapshot, "name") ?? snapshotId,
    branchId,
    branchName,
    createdAt: stringField(snapshot, "created_at"),
    expiresAt: stringField(snapshot, "expires_at"),
    fullSizeBytes: bytesField(snapshot, "full_size"),
    diffSizeBytes: bytesField(snapshot, "diff_size")
  };
}

export async function buildDatabaseRecoveryStatus(env: AppEnv): Promise<DatabaseRecoveryStatus> {
  const status = baseStatus(env);

  if (status.missingEnv.length > 0) {
    return {
      ...status,
      message: `Set ${status.missingEnv.join(" and ")} to show live database restore information.`
    };
  }

  try {
    const { restoreWindowSeconds } = await loadNeonProjectAndBranch(env);

    return {
      ...status,
      configured: true,
      connected: true,
      source: "recovery-service",
      restoreWindowSeconds,
      restoreWindowLabel: formatDuration(restoreWindowSeconds),
      message: "Live database recovery status loaded.",
      missingEnv: [],
      error: null
    };
  } catch (error) {
    return {
      ...status,
      configured: true,
      connected: false,
      message: "Database recovery settings are present, but live recovery status could not be loaded.",
      missingEnv: [],
      error: error instanceof Error ? error.message.replaceAll("Neon", "database recovery service") : "Unable to load database recovery status."
    };
  }
}

export async function listDatabaseSnapshots(env: AppEnv): Promise<DatabaseSnapshotListResult> {
  const missingEnv = missingNeonEnv(env);
  const checkedAt = new Date().toISOString();
  if (missingEnv.length > 0) {
    return {
      provider: "managed-database",
      configured: false,
      connected: false,
      snapshots: [],
      checkedAt,
      message: `Set ${missingEnv.join(" and ")} to show database restore points.`,
      missingEnv,
      error: null
    };
  }

  const projectId = env.NEON_PROJECT_ID!;
  try {
    const { branch, branchId } = await loadNeonProjectAndBranch(env);
    const payload = await neonApi<JsonRecord>(env, `/projects/${encodeURIComponent(projectId)}/snapshots`);
    const snapshots = asArray(payload.snapshots)
      .map(asRecord)
      .filter(Boolean)
      .map((snapshot) => mapSnapshot(snapshot as JsonRecord, branch))
      .filter(Boolean) as DatabaseSnapshotSummary[];
    const branchSnapshots = snapshots
      .filter((snapshot) => !snapshot.branchId || snapshot.branchId === branchId)
      .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime());

    return {
      provider: "managed-database",
      configured: true,
      connected: true,
      snapshots: branchSnapshots,
      checkedAt,
      message: branchSnapshots.length
        ? `${branchSnapshots.length} restore point${branchSnapshots.length === 1 ? "" : "s"} loaded.`
        : "No database restore points were found.",
      missingEnv: [],
      error: null
    };
  } catch (error) {
    return {
      provider: "managed-database",
      configured: true,
      connected: false,
      snapshots: [],
      checkedAt,
      message: "Database recovery settings are present, but database restore points could not be loaded.",
      missingEnv: [],
      error: error instanceof Error ? error.message.replaceAll("Neon", "database recovery service") : "Unable to load database restore points."
    };
  }
}

export async function createDatabaseSnapshot(env: AppEnv): Promise<DatabaseSnapshotCreateResult> {
  const missingEnv = missingNeonEnv(env);
  if (missingEnv.length > 0) {
    throw new Error(`Set ${missingEnv.join(" and ")} before creating a database restore point.`);
  }

  const { projectId, branchId } = await loadNeonProjectAndBranch(env);
  const createdAt = new Date().toISOString();
  const snapshotName = `MD3 Platform manual restore point - ${createdAt.replace(/\.\d{3}Z$/, "Z")}`;
  const params = new URLSearchParams({ name: snapshotName });
  const payload = await neonApi<JsonRecord>(
    env,
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/snapshot?${params.toString()}`,
    { method: "POST" }
  );
  const snapshot = asRecord(payload.snapshot);
  const operations = asArray(payload.operations).map(asRecord).filter(Boolean) as JsonRecord[];

  return {
    provider: "managed-database",
    snapshotId: stringField(snapshot, "id"),
    snapshotName: stringField(snapshot, "name") ?? snapshotName,
    createdAt: stringField(snapshot, "created_at") ?? createdAt,
    operationIds: operations.map((operation) => stringField(operation, "id")).filter(Boolean) as string[],
    message: "Database restore point request created. It may take a short time to appear."
  };
}
