import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { initializeAdmin } from "../../src/server/auth/initializeAdmin";
import { verifyPassword } from "../../src/server/auth/password";
import { PostgresRepository } from "../../src/server/repositories/postgres";
import { migrateDatabase, type MigrationSource } from "../../src/server/services/schemaMigrations";
import { ownedProcessEnv } from "./selfhostExercise";
import { exerciseFirstInstall } from "./firstInstallExercise";

export async function exerciseAdminInitialization(control: postgres.Sql, config: Parameters<typeof ownedProcessEnv>[0], migrations: MigrationSource[]) {
  const database = `init_${randomUUID().replaceAll("-", "")}`;
  await control`create database ${control(database)}`;
  const sql = postgres({ host: config.socketDir, port: config.port, database, username: config.username,
    password: config.password, ssl: false, max: 3, onnotice: () => {} });
  const password = "SyntheticInitPassword2026";
  const input = { name: "Synthetic owner", email: "Owner@example.invalid", password };
  const repo = new PostgresRepository(sql);
  async function run(args: string[], value = `${password}\n`, extra: Record<string, string> = {}) {
    const child = spawn(process.execPath, [join(config.root, "dist-server/init-admin.mjs"), ...args], {
      cwd: config.root, env: { ...ownedProcessEnv(config), DATABASE_URL: `postgres:///${database}`, BUSINESS_TEMPLATE: "personal-archive", ...extra },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.stdin.on("error", () => {}); // Early option rejection may close stdin.
    child.stdin.end(value);
    const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    try {
      const code = await Promise.race([exited, delay(10000, -1, { ref: false })]);
      assert.notEqual(code, -1, "initializer finishes");
      assert.ok(!output.includes(password) && !output.includes(config.password), "no secrets in CLI output");
      return { code, output };
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
  }
  const args = ["--email", input.email, "--password-stdin"];
  try {
    assert.equal((await run(["--help"])).code, 0);
    assert.equal((await run(args)).code, 1, "unmigrated schema refused");
    await migrateDatabase(sql, migrations);
    assert.equal((await run(["--email", input.email])).code, 1, "non-TTY requires explicit pipe mode");
    assert.equal((await run([...args, "--password", password])).code, 1, "password arguments rejected without echoing");
    assert.equal((await run(args, `${password}\n`, { PASSWORD: password })).code, 1, "password environment refused");
    assert.equal((await run(args, `${password}\nsecond-line\n`)).code, 1);
    assert.equal((await run(args, "short\n")).code, 1);
    assert.equal((await run(args, "a".repeat(5000))).code, 1);
    assert.equal((await run(args, `${password}\n`, { BUSINESS_TEMPLATE: "md3-service" })).code, 1);
    await assert.rejects(initializeAdmin(sql, { ...input, email: "system@md3-platform.local" }, migrations));
    assert.equal((await repo.listUsers()).length, 0, "rejected requests did not create users");

    // Missing audit persistence must roll back both the user and its credential.
    await sql`create function reject_init_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$`;
    await sql`create trigger reject_init_audit before insert on audit_logs for each row execute function reject_init_audit()`;
    assert.equal((await run(args)).code, 1);
    assert.equal((await repo.listUsers()).length, 0);
    assert.equal(Number((await sql`select count(*) as count from user_credentials`)[0].count), 0);
    await sql`drop trigger reject_init_audit on audit_logs`;
    await sql`drop function reject_init_audit()`;

    const results = await Promise.all([run(args), run(["--email", "second@example.invalid", "--password-stdin"])]);
    assert.deepEqual(results.map((result) => result.code).sort(), [0, 1], "concurrent CLI invocations have exactly one winner");
    const [user] = await repo.listUsers();
    assert.equal((await repo.listUsers()).length, 1);
    assert.equal(user.role, "Admin");
    assert.equal(user.email, user.email.toLowerCase());
    const credential = await repo.getUserCredential(user.userId);
    assert.ok(credential);
    assert.equal(await verifyPassword(password, credential), true);
    assert.equal(await verifyPassword("WrongSyntheticPassword2026", credential), false);
    assert.equal(credential.mustChangePassword, false);
    assert.equal(Number((await sql`select count(*) as count from audit_logs where action = 'InitializeAdmin' and user_id = ${user.userId}`)[0].count), 1);
    assert.equal((await run(args)).code, 1, "repeat initialization refuses to replace an account");
    assert.deepEqual(await repo.getUserCredential(user.userId), credential);
    await exerciseFirstInstall(config, database, user.email, password);
    await sql`update users set role = 'ReadOnly' where user_id = ${user.userId}`;
    await sql`delete from user_credentials where user_id = ${user.userId}`;
    assert.equal((await run(args)).code, 1, "existing non-admin without a password still prevents bootstrap");
  } finally {
    await sql.end({ timeout: 2 });
    await control`drop database ${control(database)}`;
  }
}
