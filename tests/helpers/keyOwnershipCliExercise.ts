import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AppRepository } from "../../src/server/repositories/types";
import { ownedProcessEnv } from "./selfhostExercise";

export async function exerciseKeyOwnershipCli(repo: AppRepository, ownerUserId: string, config: Parameters<typeof ownedProcessEnv>[0]) {
  const work = await repo.createManuscript({ title: "Synthetic CLI claim", kind: "Novel", status: "Draft" });
  async function run(args: string[]) {
    const child = spawn(process.execPath, [join(config.root, "dist-server/claim-manuscript-key-owner.mjs"), ...args], {
      cwd: config.root, env: { ...ownedProcessEnv(config), BUSINESS_TEMPLATE: "personal-archive" }, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    try {
      const code = await Promise.race([exited, delay(10000, -1, { ref: false })]);
      assert.notEqual(code, -1);
      assert.ok(!`${stdout}${stderr}`.includes(config.password));
      assert.ok(!stdout.includes("encryptedWorkKey") && !stdout.includes("recoveryEncryptedWorkKey") && !stdout.includes(work.title));
      return { code, stdout, stderr };
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
  }
  const inventory = await run([]);
  assert.equal(inventory.code, 0);
  const review = JSON.parse(inventory.stdout).unresolved.find((item: { manuscriptId: string }) => item.manuscriptId === work.manuscriptId);
  assert.ok(review);
  assert.match(review.expectedUpdatedAt, /\.\d{6}Z$/, "inventory preserves SQL microseconds for exact compare-and-swap");
  const file = join(config.runDir, "synthetic-ownership-review.json");
  await writeFile(file, JSON.stringify({ manuscriptId: work.manuscriptId, ownerUserId,
    expectedUpdatedAt: review.expectedUpdatedAt, evidenceReference: "synthetic-review/cli", operatorReference: "synthetic-maintainer" }), { mode: 0o600 });
  const dry = await run(["--claim-file", file]);
  assert.equal(dry.code, 0);
  assert.equal(JSON.parse(dry.stdout).applied, false);
  assert.equal((await repo.getManuscript(work.manuscriptId))?.keyOwnerUserId, null);
  assert.equal((await run(["--claim-file", file, "--apply"])).code, 1);
  assert.equal((await repo.getManuscript(work.manuscriptId))?.keyOwnerUserId, null);
  const args = ["--claim-file", file, "--apply", "--writers-stopped"];
  assert.equal((await run(args)).code, 0);
  assert.equal((await repo.getManuscript(work.manuscriptId))?.keyOwnerUserId, ownerUserId);
  assert.equal((await run(args)).code, 1);
}
