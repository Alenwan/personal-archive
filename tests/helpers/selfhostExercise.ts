import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type postgres from "postgres";

interface OwnedConfig { root: string; runDir: string; socketDir: string; port: number; username: string; password: string }
export function ownedProcessEnv(config: OwnedConfig): Record<string, string> {
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, DATABASE_URL: "postgres:///postgres", DATABASE_SSL: "disable",
    PGHOST: config.socketDir, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password };
}
export async function exerciseMigrationCli(config: OwnedConfig) {
  const child = spawn(process.execPath, [join(config.root, "dist-server/migrate.mjs")], { cwd: config.root, env: ownedProcessEnv(config), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  try {
    assert.equal(await Promise.race([exited, delay(10000, -1, { ref: false })]), 0, "bundled migration CLI did not complete");
    assert.match(output, /0 applied; \d+ checksums verified/);
    assert.ok(!output.includes(config.password));
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } }
}

export async function exerciseSelfhost(sql: postgres.Sql, config: OwnedConfig) {
  // HTTP storage fixture tests the production S3 adapter's request path. It
  // does not implement or certify any vendor's signature/IAM implementation.
  const values = new Map<string, Buffer>();
  const operations: string[] = [];
  let backupWritable = true;
  const storage = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url!, "http://127.0.0.1").pathname);
    const valid = /^\/(documents|backups)\/__personal_archive_probe__\/[a-f0-9-]+$/.test(path);
    if (!valid || !request.headers.authorization?.startsWith("AWS4-HMAC-SHA256")) { response.writeHead(403).end(); return; }
    operations.push(`${request.method} ${path}`);
    if (request.method === "PUT") {
      if (!backupWritable && path.startsWith("/backups/")) { request.resume(); response.writeHead(403).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      values.set(path, Buffer.concat(chunks)); response.writeHead(200).end();
    } else if (request.method === "DELETE") { values.delete(path); response.writeHead(204).end(); }
    else { const value = values.get(path); response.writeHead(value ? 200 : 404).end(value); }
  });
  await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
  const storageAddress = storage.address();
  assert.ok(storageAddress && typeof storageAddress === "object");
  const staticRoot = join(config.runDir, "selfhost-static");
  await mkdir(staticRoot);
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>Synthetic readiness fixture</title>");
  const key = randomBytes(32).toString("hex");
  const environment = { ...ownedProcessEnv(config), APP_ENV: "production", BUSINESS_TEMPLATE: "personal-archive", HOST: "127.0.0.1", STATIC_ROOT: staticRoot,
    S3_ENDPOINT: `http://127.0.0.1:${storageAddress.port}`, S3_ACCESS_KEY_ID: "synthetic", S3_SECRET_ACCESS_KEY: key,
    DOCUMENT_BUCKET_NAME: "documents", BACKUP_BUCKET_NAME: "backups", S3_FORCE_PATH_STYLE: "true",
    CREDENTIAL_ENCRYPTION_KEY: key, MANUSCRIPT_RECOVERY_KEY: key, PRIVATE_VAULT_RECOVERY_KEY: key };
  const children: { child: ChildProcess; exited: Promise<number | null> }[] = [];
  async function launch(overrides: Record<string, string> = {}) {
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const address = reservation.address(); assert.ok(address && typeof address === "object");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const child = spawn(process.execPath, [join(config.root, "dist-server/selfhost.mjs")], { cwd: config.root,
      env: { ...environment, PORT: String(address.port), ...overrides }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout!.on("data", (chunk) => { log += chunk; }); child.stderr!.on("data", (chunk) => { log += chunk; });
    const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    children.push({ child, exited });
    const until = Date.now() + 10000;
    while (Date.now() < until && child.exitCode === null && child.signalCode === null && !log.includes("self-host server listening")) await delay(30);
    assert.ok(!log.includes(key) && !log.includes(config.password), "startup logs exposed synthetic secrets");
    return { child, exited, log: () => log, url: `http://127.0.0.1:${address.port}` };
  }
  try {
    const invalid: Record<string, string>[] = [{ DATABASE_URL: "", POSTGRES_URL: "" }, { MANUSCRIPT_RECOVERY_KEY: "" }];
    for (const overrides of invalid) {
      const failed = await launch(overrides);
      assert.equal(failed.child.exitCode, 1);
      assert.ok(!failed.log().includes("self-host server listening"));
    }
    assert.equal(operations.length, 0, "invalid config reached storage");
    backupWritable = false;
    const denied = await launch();
    assert.equal(denied.child.exitCode, 1, "readonly backup storage must prevent startup");
    assert.ok(!denied.log().includes("self-host server listening"));
    backupWritable = true;
    const healthy = await launch();
    assert.match(healthy.log(), /self-host server listening/);
    const get = (path: string) => fetch(healthy.url + path, { signal: AbortSignal.timeout(3000) });
    assert.equal((await get("/healthz")).status, 200);
    assert.equal((await get("/readyz")).status, 200);
    assert.equal(values.size, 0, "probe left objects behind");
    assert.ok(operations.some((item) => item.startsWith("PUT /documents/")));
    assert.ok(operations.some((item) => item.startsWith("PUT /backups/")));
    const [migration] = await sql`select file_name, sha256 from schema_migrations order by file_name limit 1`;
    try {
      await sql`update schema_migrations set sha256 = 'synthetic-mismatch' where file_name = ${migration.file_name}`;
      assert.equal((await get("/readyz")).status, 503);
      assert.equal((await get("/healthz")).status, 200);
      const rejected = await launch();
      assert.equal(rejected.child.exitCode, 1, "a mismatched schema must prevent startup");
    } finally { await sql`update schema_migrations set sha256 = ${migration.sha256} where file_name = ${migration.file_name}`; }
    assert.equal((await get("/readyz")).status, 200);
    assert.ok(!healthy.log().includes(key) && !healthy.log().includes(config.password));
  } finally {
    for (const { child, exited } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const ended = await Promise.race([exited.then(() => true), delay(3000, false, { ref: false })]);
      if (!ended) { child.kill("SIGKILL"); await exited; }
    }
    storage.closeAllConnections();
    await new Promise<void>((resolve) => storage.close(() => resolve()));
  }
}
