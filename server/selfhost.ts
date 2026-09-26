import { createReadStream } from "node:fs";
import { readFile, stat, statfs } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cpus, freemem, loadavg, totalmem, uptime as systemUptime } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { app } from "../functions/api/[[path]]";
import { readSessionUser } from "../src/server/auth/session";
import type { AppEnv } from "../src/server/env";
import { createRepository } from "../src/server/repositories/factory";
import { credentialEncryptionKeyWarning } from "../src/server/services/credentialCrypto";
import { startStorageCleanupWorker } from "../src/server/services/storageCleanup";
import { createBackupStorage, createDocumentStorage } from "../src/server/storage/documentStorage";
import { DEFAULT_MAX_UPLOAD_MB } from "../src/shared/demoLimits";
import type { SystemStatus, SystemStatusService, SystemStatusStorageMetric } from "../src/shared/types";
import { startPbxAmiListener } from "./pbxAmiListener";
import postgres from "postgres";
import { ephemeralMode, validateSelfhostConfig } from "../src/server/runtimeConfig";
import { checkSchema, type MigrationSignature } from "../src/server/services/schemaMigrations";
import { createReadinessCheck } from "../src/server/services/readiness";

declare const __ARCHIVE_MIGRATIONS__: MigrationSignature[];

const port = Number(process.env.PORT || "8080");
const host = process.env.HOST || "0.0.0.0";
const staticRoot = resolve(process.env.STATIC_ROOT || "dist");
const env = { ...process.env, APP_ENV: process.env.APP_ENV || "production" } as AppEnv;
const readinessTimeoutMs = 5_000;
let checkDependencies: () => Promise<void>;
try {
  validateSelfhostConfig(env);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid.");
  if (!(await stat(join(staticRoot, "index.html"))).isFile()) throw new Error("Static entry point is missing.");
  const schemaSql = ephemeralMode(env) ? null : postgres(env.DATABASE_URL || env.POSTGRES_URL!, {
    max: 1, connect_timeout: 5, idle_timeout: 20, connection: { statement_timeout: 5000 },
    ...(env.DATABASE_SSL ? { ssl: ["false", "disable"].includes(env.DATABASE_SSL) ? false : "require" as const } : {})
  });
  checkDependencies = createReadinessCheck(
    schemaSql ? () => checkSchema(schemaSql, __ARCHIVE_MIGRATIONS__) : () => createRepository(env).healthCheck(),
    [createDocumentStorage(env), createBackupStorage(env)]
  );
  await checkDependencies();
} catch {
  console.error("Startup refused: validate configuration, matching migration checksums, static build and writable document/backup storage. No requests or workers were started.");
  process.exit(1);
}

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function safeStaticPath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname.split("?")[0] || "/");
  const relativePath = normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const filePath = resolve(join(staticRoot, relativePath || "index.html"));
  return filePath.startsWith(staticRoot) ? filePath : null;
}

class RequestBodyTooLargeError extends Error {}

function configuredUploadLimitBytes(): number {
  const configured = Number.parseInt(env.MAX_UPLOAD_MB ?? "", 10);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_MB;
  return megabytes * 1024 * 1024;
}

function requestBodyLimitBytes(request: IncomingMessage): number {
  const contentType = request.headers["content-type"]?.toLowerCase() ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    // Multipart headers and boundaries add a small amount beyond the file itself.
    return configuredUploadLimitBytes() + 8 * 1024 * 1024;
  }
  if (/^\/api\/manuscripts\/[^/]+\/encryption\/(?:enable|disable)(?:\?|$)/.test(request.url ?? "")) {
    return 128 * 1024 * 1024;
  }
  if (/^\/api\/manuscripts\//.test(request.url ?? "")) return 16 * 1024 * 1024;
  return 8 * 1024 * 1024;
}

function requestBody(request: IncomingMessage): Promise<Buffer<ArrayBuffer> | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return Promise.resolve(undefined);
  const limitBytes = requestBodyLimitBytes(request);
  const declaredLength = Number.parseInt(request.headers["content-length"] ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    request.resume();
    return Promise.reject(new RequestBodyTooLargeError());
  }
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let settled = false;

    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > limitBytes) {
        settled = true;
        cleanup();
        request.resume();
        reject(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveBody(Buffer.concat(chunks, receivedBytes));
    };
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function requestUrl(request: IncomingMessage): string {
  const proto = request.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim() || "http";
  const hostHeader = request.headers["x-forwarded-host"]?.toString().split(",")[0]?.trim() || request.headers.host || `localhost:${port}`;
  return `${proto}://${hostHeader}${request.url || "/"}`;
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

function jsonResponse(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store"
  }).end(JSON.stringify(body));
}

function percentage(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function positiveNumber(value: string | null | undefined): number | null {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function readMemoryUsage(): Promise<{ totalBytes: number; usedBytes: number; availableBytes: number }> {
  let hostTotalBytes = totalmem();
  let hostAvailableBytes = freemem();
  const meminfo = await readOptionalText("/proc/meminfo");
  if (meminfo) {
    const values = new Map(
      meminfo.split("\n").flatMap((line) => {
        const match = line.match(/^([^:]+):\s+(\d+)\s+kB$/);
        return match ? [[match[1], Number(match[2]) * 1024] as const] : [];
      })
    );
    hostTotalBytes = values.get("MemTotal") ?? hostTotalBytes;
    hostAvailableBytes = values.get("MemAvailable") ?? values.get("MemFree") ?? hostAvailableBytes;
  }

  const cgroupCandidates = [
    ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max"],
    ["/sys/fs/cgroup/memory/memory.usage_in_bytes", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]
  ] as const;
  for (const [currentPath, limitPath] of cgroupCandidates) {
    const [currentText, limitText] = await Promise.all([readOptionalText(currentPath), readOptionalText(limitPath)]);
    const currentBytes = positiveNumber(currentText);
    const limitBytes = positiveNumber(limitText);
    if (currentBytes !== null && limitBytes !== null && limitBytes <= hostTotalBytes) {
      const usedBytes = Math.min(currentBytes, limitBytes);
      return { totalBytes: limitBytes, usedBytes, availableBytes: Math.max(0, limitBytes - usedBytes) };
    }
  }

  const usedBytes = Math.max(0, hostTotalBytes - hostAvailableBytes);
  return { totalBytes: hostTotalBytes, usedBytes, availableBytes: hostAvailableBytes };
}

function storageMetric(result: PromiseSettledResult<{ bytes: number; objectCount?: number }>): SystemStatusStorageMetric {
  return result.status === "fulfilled"
    ? { status: "healthy", bytes: result.value.bytes, objectCount: result.value.objectCount ?? null }
    : { status: "unavailable", bytes: null, objectCount: null };
}

const storageUsageCacheTtlMs = 5 * 60 * 1000;
const unavailableStorageCacheTtlMs = 15 * 1000;

interface StorageUsageSnapshot {
  documents: SystemStatusStorageMetric;
  backups: SystemStatusStorageMetric;
  updatedAt: string;
}

let storageUsageCache: { snapshot: StorageUsageSnapshot; expiresAt: number } | null = null;
let storageUsageRefresh: Promise<StorageUsageSnapshot> | null = null;

async function refreshStorageUsage(): Promise<StorageUsageSnapshot> {
  const [documentResult, backupResult] = await Promise.allSettled([
    Promise.resolve().then(() => createDocumentStorage(env).usage()),
    Promise.resolve().then(() => createBackupStorage(env).usage())
  ] as const);
  const snapshot: StorageUsageSnapshot = {
    documents: storageMetric(documentResult),
    backups: storageMetric(backupResult),
    updatedAt: new Date().toISOString()
  };
  const allHealthy = snapshot.documents.status === "healthy" && snapshot.backups.status === "healthy";
  storageUsageCache = {
    snapshot,
    expiresAt: Date.now() + (allHealthy ? storageUsageCacheTtlMs : unavailableStorageCacheTtlMs)
  };
  return snapshot;
}

async function readStorageUsage(forceRefresh: boolean): Promise<StorageUsageSnapshot> {
  if (!forceRefresh && storageUsageCache && storageUsageCache.expiresAt > Date.now()) {
    return storageUsageCache.snapshot;
  }
  if (!storageUsageRefresh) {
    storageUsageRefresh = refreshStorageUsage().finally(() => {
      storageUsageRefresh = null;
    });
  }
  return storageUsageRefresh;
}

function storageService(
  id: SystemStatusService["id"],
  label: string,
  metric: SystemStatusStorageMetric,
  healthyDetail: string
): SystemStatusService {
  return {
    id,
    label,
    status: metric.status,
    detail: metric.status === "healthy" ? healthyDetail : "Status check unavailable"
  };
}

async function handleSystemStatus(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    jsonResponse(response, 405, { error: "Method not allowed" });
    return;
  }

  const repo = createRepository(env);
  const sessionRequest = new Request(requestUrl(request), { method: "GET", headers: requestHeaders(request) });
  const user = await readSessionUser(sessionRequest, repo);
  if (!user) {
    jsonResponse(response, 401, { error: "Unauthorized" });
    return;
  }
  if (user.role !== "Admin") {
    jsonResponse(response, 403, { error: "Forbidden" });
    return;
  }

  const forceStorageRefresh = new URL(requestUrl(request)).searchParams.get("refreshStorage") === "1";

  const [diskStats, memoryResult, databaseResult, storageResult, latestBackupResult] = await Promise.allSettled([
    statfs("/"),
    readMemoryUsage(),
    Promise.all([repo.healthCheck(), repo.getDatabaseSizeBytes()]).then(([, bytes]) => ({ bytes: bytes ?? 0 })),
    readStorageUsage(forceStorageRefresh),
    repo.listBackupRuns(1)
  ] as const);

  if (diskStats.status === "rejected") throw diskStats.reason;
  if (memoryResult.status === "rejected") throw memoryResult.reason;
  const diskTotalBytes = diskStats.value.bsize * diskStats.value.blocks;
  const diskAvailableBytes = diskStats.value.bsize * diskStats.value.bavail;
  const diskUsedBytes = Math.max(0, diskTotalBytes - diskAvailableBytes);
  const memoryTotalBytes = memoryResult.value.totalBytes;
  const memoryAvailableBytes = memoryResult.value.availableBytes;
  const memoryUsedBytes = memoryResult.value.usedBytes;
  const database = storageMetric(databaseResult);
  const storageSnapshot = storageResult.status === "fulfilled"
    ? storageResult.value
    : {
        documents: { status: "unavailable", bytes: null, objectCount: null } as SystemStatusStorageMetric,
        backups: { status: "unavailable", bytes: null, objectCount: null } as SystemStatusStorageMetric,
        updatedAt: new Date().toISOString()
      };
  const { documents, backups } = storageSnapshot;
  const services: SystemStatusService[] = [
    { id: "application", label: "Personal Archive", status: "healthy", detail: "Application is responding" },
    storageService("database", "PostgreSQL", database, "Connected and accepting queries"),
    storageService("document-storage", "Document storage", documents, "Connected to object storage"),
    storageService("backup-storage", "Backup storage", backups, "Connected to backup object storage")
  ];
  const diskUsagePercent = percentage(diskUsedBytes, diskTotalBytes);
  const memoryUsagePercent = percentage(memoryUsedBytes, memoryTotalBytes);
  const needsAttention = diskUsagePercent >= 85
    || memoryUsagePercent >= 90
    || services.some((service) => service.status !== "healthy");
  const load = loadavg();
  const latestBackup = latestBackupResult.status === "fulfilled" ? latestBackupResult.value[0] ?? null : null;
  const payload: SystemStatus = {
    generatedAt: new Date().toISOString(),
    overallStatus: needsAttention ? "attention" : "healthy",
    disk: {
      totalBytes: diskTotalBytes,
      usedBytes: diskUsedBytes,
      availableBytes: diskAvailableBytes,
      usagePercent: diskUsagePercent
    },
    memory: {
      totalBytes: memoryTotalBytes,
      usedBytes: memoryUsedBytes,
      availableBytes: memoryAvailableBytes,
      usagePercent: memoryUsagePercent
    },
    runtime: {
      serverUptimeSeconds: Math.round(systemUptime()),
      applicationUptimeSeconds: Math.round(process.uptime()),
      cpuCount: cpus().length,
      loadAverage: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0]
    },
    storage: { objectUsageUpdatedAt: storageSnapshot.updatedAt, database, documents, backups },
    services,
    latestBackup: latestBackup
      ? {
          status: latestBackup.status,
          completedAt: latestBackup.completedAt,
          itemCount: latestBackup.itemCount,
          failedItems: latestBackup.failedItems,
          message: latestBackup.message
        }
      : null
  };
  jsonResponse(response, 200, payload);
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const headers = requestHeaders(request);

  const body = await requestBody(request);
  const fetchRequest = new Request(requestUrl(request), {
    method: request.method,
    headers,
    body
  });
  const fetchResponse = await app.fetch(fetchRequest, env, {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined
  } as unknown as ExecutionContext);

  response.statusCode = fetchResponse.status;
  response.statusMessage = fetchResponse.statusText;
  const getSetCookie = (fetchResponse.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = getSetCookie?.call(fetchResponse.headers) ?? [];
  const fallbackSetCookie = fetchResponse.headers.get("set-cookie");
  fetchResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") response.setHeader(key, value);
  });
  if (setCookies.length) response.setHeader("set-cookie", setCookies);
  else if (fallbackSetCookie) response.setHeader("set-cookie", fallbackSetCookie);

  if (!fetchResponse.body) {
    response.end();
    return;
  }
  Readable.fromWeb(fetchResponse.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(response);
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const candidatePath = safeStaticPath(pathname);
  if (!candidatePath) {
    response.writeHead(400).end("Bad request");
    return;
  }

  const filePath = await stat(candidatePath)
    .then(async (entry) => {
      if (!entry.isDirectory()) return candidatePath;
      const indexPath = join(candidatePath, "index.html");
      return stat(indexPath)
        .then(() => indexPath)
        .catch(() => (pathname.startsWith("/assets/") ? null : join(staticRoot, "index.html")));
    })
    .catch(() => (pathname.startsWith("/assets/") ? null : join(staticRoot, "index.html")));

  if (!filePath) {
    response.writeHead(404).end("Not found");
    return;
  }

  const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
  });
  createReadStream(filePath).pipe(response);
}

async function readinessCheck(): Promise<void> {
  const checks = checkDependencies();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checks,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Readiness check timed out")), readinessTimeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(requestUrl(request));
    if (url.pathname === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/readyz") {
      try {
        await readinessCheck();
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch (error) {
        console.error("Readiness check failed.");
        response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ ok: false }));
      }
      return;
    }
    if (url.pathname === "/api/system-status") {
      await handleSystemStatus(request, response);
      return;
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }
    if (url.pathname === "/assets") {
      response.writeHead(308, { location: "/managed-assets" }).end();
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      if (!response.headersSent) {
        response.writeHead(413, { "content-type": "application/json; charset=utf-8" });
      }
      response.end(JSON.stringify({ error: `Request body exceeds the ${configuredUploadLimitBytes() / 1024 / 1024} MB upload limit.` }));
      return;
    }
    console.error(error);
    if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
});

server.listen(port, host, () => {
  const productName = process.env.BUSINESS_TEMPLATE === "personal-archive" ? "Personal Archive" : "MD3 Platform";
  console.log(`${productName} self-host server listening on http://${host}:${port}`);
  const credentialWarning = credentialEncryptionKeyWarning(env);
  if (credentialWarning) console.warn(`Credential encryption warning: ${credentialWarning}`);
  startStorageCleanupWorker(env);
  if (env.BUSINESS_TEMPLATE !== "personal-archive") startPbxAmiListener(env);
});
