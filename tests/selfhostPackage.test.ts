import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseEnv } from "node:util";

const configure = join(process.cwd(), "release/selfhost/configure.mjs");
function run(directory: string) {
  return spawnSync(process.execPath, [configure], { cwd: directory, env: { PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 5000 });
}

test("installation creates independent private keys once and leaves S3 configuration explicit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pa-config-test-"));
  try {
    const result = run(directory);
    assert.equal(result.status, 0);
    const original = await readFile(join(directory, ".env"), "utf8");
    const config = parseEnv(original);
    const names = ["POSTGRES_PASSWORD", "CREDENTIAL_ENCRYPTION_KEY", "MANUSCRIPT_RECOVERY_KEY", "PRIVATE_VAULT_RECOVERY_KEY"];
    for (const name of names) {
      const value = config[name];
      assert.ok(value);
      assert.match(value, /^[a-f0-9]{64}$/);
      assert.ok(!result.stdout.includes(value) && !result.stderr.includes(value));
    }
    assert.equal(new Set(names.map((name) => config[name])).size, names.length);
    assert.match(config.COMPOSE_PROJECT_NAME ?? "", /^personal-archive-[a-f0-9]{12}$/);
    assert.equal(config.S3_ENDPOINT, "");
    assert.equal(config.S3_SECRET_ACCESS_KEY, "");
    assert.equal((await stat(join(directory, ".env"))).mode & 0o777, 0o600);
    assert.equal(run(directory).status, 1);
    assert.equal(await readFile(join(directory, ".env"), "utf8"), original, "retry must not rotate keys or volume identity");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("installation refuses an existing configuration symlink without modifying its target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pa-config-test-"));
  try {
    const original = "synthetic-existing-configuration";
    await writeFile(join(directory, "existing"), original);
    await symlink(join(directory, "existing"), join(directory, ".env"));
    assert.equal(run(directory).status, 1);
    assert.equal(await readFile(join(directory, "existing"), "utf8"), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
