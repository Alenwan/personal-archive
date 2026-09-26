import { build } from "esbuild";
import { spawn } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";

// This launcher starts its own server. It never accepts a pre-existing database,
// including one called localhost. A separate private socket identifies each run.
for (const name of ["DATABASE_URL", "POSTGRES_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS", "PA_PG_TEST_CONFIG", "PA_PG_TEST_NONCE"]) {
  if (process.env[name] !== undefined) throw new Error(`Refusing inherited ${name}; use a clean environment.`);
}
const root = await realpath(process.cwd());
const toolsDir = join(root, ".tools");
await mkdir(toolsDir, { recursive: true });
if (await realpath(toolsDir) !== toolsDir) throw new Error("Refusing a symlinked .tools directory.");
const binDir = resolve(process.env.POSTGRES_BIN_DIR || join(toolsDir, "postgres-runtime", "node_modules", "@embedded-postgres", `${process.platform}-${process.arch}`, "native", "bin"));
let clientBinDir = process.env.POSTGRES_CLIENT_BIN_DIR;
if (!clientBinDir) {
  try { await access(join(toolsDir, "postgres-client", "bin", "pg_dump")); clientBinDir = join(toolsDir, "postgres-client", "bin"); }
  catch { clientBinDir = binDir; }
}
clientBinDir = resolve(clientBinDir);
for (const name of ["initdb", "postgres"]) {
  try { await access(join(binDir, name)); }
  catch { throw new Error(`Missing ${name}; install verified PostgreSQL binaries and set POSTGRES_BIN_DIR. See docs/testing/POSTGRES_TESTING.md.`); }
}
for (const name of ["pg_dump", "pg_restore"]) {
  try { await access(join(clientBinDir, name)); }
  catch { throw new Error(`Missing ${name}; set POSTGRES_CLIENT_BIN_DIR to verified PostgreSQL 16 client tools.`); }
}
const runDir = await mkdtemp(join(toolsDir, "postgres-test-"));
// macOS Unix socket paths have a short length limit; the data stays in .tools.
const socketDir = await realpath(await mkdtemp(join(tmpdir(), "pa-pg-socket-")));
await chmod(runDir, 0o700);
await chmod(socketDir, 0o700);
const runId = randomUUID();
const nonce = randomBytes(32).toString("hex");
const ownerMarker = JSON.stringify({ runId, nonce });
const markerName = "personal-archive-test-owner.json";
await writeFile(join(runDir, markerName), ownerMarker, { mode: 0o600 });
await writeFile(join(socketDir, markerName), ownerMarker, { mode: 0o600 });
const dataDir = join(runDir, "data");
const config = {
  runId, nonce, root, runDir, socketDir, dataDir, binDir, clientBinDir,
  username: `pa_${randomBytes(8).toString("hex")}`,
  password: randomBytes(32).toString("base64url"),
  port: randomInt(49152, 65535), database: "postgres"
};
const configPath = join(runDir, "connection.json");
const passwordFile = join(runDir, "init-password");
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
await writeFile(passwordFile, `${config.password}\n`, { mode: 0o600 });
const childEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: "C", LC_ALL: "C", NODE_ENV: "test" };
let activeCommand;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  if (activeCommand?.exitCode === null) activeCommand.kill("SIGINT");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

async function command(file, args, { inherit = false, env = childEnv } = {}) {
  if (interrupted) throw new Error("Test run interrupted.");
  const child = spawn(file, args, { cwd: root, env, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
  activeCommand = child;
  let output = "";
  if (!inherit) {
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
  }
  const code = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => done(value ?? 1));
  });
  activeCommand = null;
  if (code !== 0) throw new Error(`${basename(file)} failed (${code}). ${inherit ? "See test output." : output}`);
  return output.trim();
}

let server;
let serverExit;
let startupLog = "";
let probe;
try {
  const version = await command(join(binDir, "postgres"), ["--version"]);
  console.log(`Disposable native database: ${version}; platform=${process.platform}/${process.arch}; private Unix socket, TCP disabled.`);
  await command(join(binDir, "initdb"), ["-D", dataDir, "-U", config.username, "--pwfile", passwordFile, "--auth-local=scram-sha-256", "--auth-host=reject", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
  await rm(passwordFile);
  server = spawn(join(binDir, "postgres"), ["-D", dataDir, "-k", socketDir, "-p", String(config.port), "-c", "listen_addresses=", "-c", "unix_socket_permissions=0700", "-c", "max_connections=20", "-c", "shared_buffers=32MB"], {
    cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { startupLog = (startupLog + chunk).slice(-16000); });
  server.stderr.on("data", (chunk) => { startupLog = (startupLog + chunk).slice(-16000); });
  serverExit = new Promise((done) => { server.once("exit", done); server.once("error", done); });
  probe = postgres({ host: socketDir, port: config.port, database: config.database, username: config.username, password: config.password, ssl: false, max: 1, connect_timeout: 1, onnotice: () => {} });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (interrupted) throw new Error("Test run interrupted.");
    if (server.exitCode !== null) throw new Error(`Owned test PostgreSQL exited during startup: ${startupLog}`);
    try { await probe`select 1`; ready = true; break; } catch { await delay(100); }
  }
  if (!ready) throw new Error(`Owned test PostgreSQL did not become ready: ${startupLog}`);
  const [identity] = await probe`select current_setting('data_directory') as data_dir, current_setting('listen_addresses') as listen_addresses, current_user as username, inet_server_addr() as network_address`;
  if (identity.data_dir !== dataDir || identity.listen_addresses !== "" || identity.username !== config.username || identity.network_address !== null) throw new Error("Disposable PostgreSQL identity check failed.");
  await probe.end();
  probe = null;
  const outfile = join(runDir, "postgres.integration.mjs");
  await command(process.execPath, [join(root, "scripts", "build-selfhost.mjs")]);
  await build({ entryPoints: [join(root, "tests", "postgres.integration.ts")], outfile, bundle: true, packages: "external", platform: "node", format: "esm", target: "node22" });
  await command(process.execPath, ["--test", outfile], {
    inherit: true, env: { ...childEnv, PA_PG_TEST_CONFIG: configPath, PA_PG_TEST_NONCE: nonce }
  });
} finally {
  if (probe) await probe.end({ timeout: 1 }).catch(() => {});
  let stopped = !server || server.exitCode !== null;
  if (server && !stopped) {
    server.kill("SIGINT"); // Only the process created above; never a PID/socket supplied by a caller.
    stopped = await Promise.race([serverExit.then(() => true), delay(10000, undefined, { ref: false }).then(() => false)]);
  }
  if (!stopped) {
    console.error(`Owned PostgreSQL did not stop; retaining its data at ${runDir}. No directory cleanup attempted.`);
    process.exitCode = 1;
  } else {
    for (const directory of [runDir, socketDir]) {
      if (await realpath(directory) !== directory || await readFile(join(directory, markerName), "utf8") !== ownerMarker) {
        throw new Error("Ownership marker changed; refusing to delete test directory.");
      }
      await rm(directory, { recursive: true });
    }
    console.log("Owned PostgreSQL stopped; this run's temporary data and socket removed.");
  }
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
