import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";

for (const key of ["DATABASE_URL", "POSTGRES_URL", "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSERVICE", "PGOPTIONS", "PA_BOOKMARK_SOCKET"]) {
  if (process.env[key]) throw new Error(`Refusing inherited ${key}`);
}
const bin = resolve(process.env.POSTGRES_BIN_DIR || ".tools/postgres/bin");
const clients = resolve(process.env.POSTGRES_CLIENT_BIN_DIR || bin);
const dir = await mkdtemp(join(tmpdir(), "pa-bookmark-test-"));
await mkdir("node_modules/.cache", { recursive: true });
const output = await mkdtemp(resolve("node_modules/.cache/bookmarks-"));
const env = { PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf("/"))}:/usr/bin:/bin`, LANG: "C", LC_ALL: "C" };
let started = false;
try {
  execFileSync(join(bin, "initdb"), ["-D", join(dir, "data"), "-U", "bookmark_test", "--auth=trust", "--no-locale", "--encoding=UTF8"], { env, stdio: "pipe" });
  execFileSync(join(bin, "pg_ctl"), ["-D", join(dir, "data"), "-l", join(dir, "postgres.log"), "-o", `-h '' -k ${dir} -p 55439 -F`, "-w", "start"], { env, stdio: "pipe" });
  started = true;
  await build({ entryPoints: ["tests/manuscriptBookmarks.test.ts"], outfile: join(output, "test.mjs"), platform: "node", format: "esm", bundle: true, packages: "external" });
  const result = spawnSync(process.execPath, ["--test", join(output, "test.mjs")], { env: { ...env, PA_BOOKMARK_SOCKET: dir, PA_BOOKMARK_CLIENT_BIN: clients }, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  if (started) execFileSync(join(bin, "pg_ctl"), ["-D", join(dir, "data"), "-m", "fast", "-w", "stop"], { env, stdio: "pipe" });
  await rm(dir, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
}
