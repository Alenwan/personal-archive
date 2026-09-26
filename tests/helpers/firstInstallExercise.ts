import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ownedProcessEnv } from "./selfhostExercise";

// A real selfhost process and PostgreSQL, with a deliberately limited HTTP S3
// fixture. This proves application wiring, not a vendor's signatures or Docker.
export async function exerciseFirstInstall(config: Parameters<typeof ownedProcessEnv>[0], database: string, email: string, password: string) {
  const objects = new Map<string, Buffer>();
  let retiredIntegrationCalls = 0;
  const storage = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    if (path.startsWith("/retired-forgejo")) retiredIntegrationCalls += 1;
    if (!/^\/(documents|backups)\/.+/.test(path) || !request.headers.authorization?.startsWith("AWS4-HMAC-SHA256")) {
      request.resume(); response.writeHead(403).end(); return;
    }
    if (request.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      objects.set(path, Buffer.concat(chunks)); response.writeHead(200).end();
    } else if (request.method === "DELETE") { objects.delete(path); response.writeHead(204).end(); }
    else { const value = objects.get(path); response.writeHead(value ? 200 : 404).end(value); }
  });
  await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
  const address = storage.address(); assert.ok(address && typeof address === "object");
  const staticRoot = join(config.runDir, "first-install-static");
  await mkdir(staticRoot);
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>Synthetic installation</title>");
  const secret = randomBytes(32).toString("hex");
  const environment = { ...ownedProcessEnv(config), DATABASE_URL: `postgres:///${database}`, APP_ENV: "production", BUSINESS_TEMPLATE: "personal-archive",
    HOST: "127.0.0.1", STATIC_ROOT: staticRoot, S3_ENDPOINT: `http://127.0.0.1:${address.port}`, S3_ACCESS_KEY_ID: "synthetic",
    S3_SECRET_ACCESS_KEY: secret, DOCUMENT_BUCKET_NAME: "documents", BACKUP_BUCKET_NAME: "backups",
    CREDENTIAL_ENCRYPTION_KEY: secret, MANUSCRIPT_RECOVERY_KEY: secret, PRIVATE_VAULT_RECOVERY_KEY: secret, PBX_AMI_ENABLED: "false",
    FORGEJO_BASE_URL: `http://127.0.0.1:${address.port}/retired-forgejo`, FORGEJO_API_TOKEN: secret, FORGEJO_OWNER: "synthetic" };
  const children: { child: ChildProcess; exited: Promise<number | null> }[] = [];
  const logs: string[] = [];
  async function launch() {
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address(); assert.ok(port && typeof port === "object");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const child = spawn(process.execPath, [join(config.root, "dist-server/selfhost.mjs")], {
      cwd: config.root, env: { ...environment, PORT: String(port.port) }, stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const record = (chunk: Buffer) => { output += chunk.toString(); logs.push(chunk.toString()); };
    child.stdout!.on("data", record); child.stderr!.on("data", record);
    const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    children.push({ child, exited });
    for (let i = 0; i < 150 && !output.includes("self-host server listening") && child.exitCode === null; i += 1) await delay(30);
    assert.match(output, /self-host server listening/, "fresh installation starts");
    return { child, exited, url: `http://127.0.0.1:${port.port}` };
  }
  async function stop(running: { child: ChildProcess; exited: Promise<number | null> }) {
    if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill("SIGTERM");
    if (!await Promise.race([running.exited.then(() => true), delay(3000, false, { ref: false })])) {
      running.child.kill("SIGKILL"); await running.exited;
    }
  }
  const get = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  async function login(url: string) {
    const result = await get(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(result.status, 200, "CLI-created administrator signs in through HTTP");
    assert.equal((await result.json() as { user: { role: string } }).user.role, "Admin");
    const cookie = result.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
    return cookie;
  }
  try {
    const first = await launch();
    assert.equal((await get(`${first.url}/healthz`)).status, 200);
    assert.equal((await get(`${first.url}/readyz`)).status, 200);
    assert.equal((await get(`${first.url}/api/documents`)).status, 401);
    const cookie = await login(first.url);
    const status = await get(`${first.url}/api/system-status`, { headers: { cookie } });
    assert.equal(status.status, 200);
    const snapshot = await status.json() as { services: { id: string }[] };
    assert.deepEqual(snapshot.services.map((service) => service.id).sort(), ["application", "backup-storage", "database", "document-storage"]);
    assert.equal(retiredIntegrationCalls, 0, "retained Forgejo configuration must not trigger status probes");
    const body = "Synthetic first-install document. 测试资料。";
    const form = new FormData(); form.append("file", new File([body], "installation.txt", { type: "text/plain" }));
    const uploaded = await get(`${first.url}/api/documents`, { method: "POST", headers: { cookie }, body: form });
    assert.equal(uploaded.status, 201);
    const document = await uploaded.json() as { documentId: string };
    for (const action of ["preview", "download"]) {
      const result = await get(`${first.url}/api/documents/${document.documentId}/${action}`, { headers: { cookie } });
      assert.equal(result.status, 200); assert.equal(await result.text(), body);
    }
    await stop(first);
    const second = await launch();
    const secondCookie = await login(second.url);
    const retained = await get(`${second.url}/api/documents/${document.documentId}/download`, { headers: { cookie: secondCookie } });
    assert.equal(retained.status, 200); assert.equal(await retained.text(), body, "database metadata and S3 object survive application restart");
    assert.equal((await get(`${second.url}/readyz`)).status, 200);
    console.log("Fresh install verified: CLI administrator login, upload/preview/download and application restart; native PostgreSQL with HTTP S3 fixture.");
  } finally {
    for (const child of children) await stop(child);
    storage.closeAllConnections();
    await new Promise<void>((resolve) => storage.close(() => resolve()));
    for (const value of [password, secret, config.password]) assert.ok(!logs.join("").includes(value), "runtime logs do not expose secrets");
  }
}
