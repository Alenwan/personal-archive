import assert from "node:assert/strict";
import test from "node:test";
import { DemoRepository } from "../src/server/repositories/memory";
import { expectedDemoPassword } from "../src/server/auth/demoAccess";
import { hashPassword, verifyPassword } from "../src/server/auth/password";
import { createSessionExpiry, createSessionToken, hashSessionToken } from "../src/server/auth/session";

test("missing credentials never use a demo password unless demo mode is explicit", () => {
  for (const mode of [undefined, "false", "0"]) {
    for (const readonly of ["true", "false"]) {
      assert.equal(expectedDemoPassword("any@example.invalid", { DEMO_MODE: mode, PUBLIC_DEMO_READONLY: readonly, DEMO_PASSWORD: "synthetic-demo-value" }), "");
    }
  }
  assert.equal(expectedDemoPassword("any@example.invalid", { DEMO_MODE: "true", DEMO_PASSWORD: "synthetic-demo-value" }), "synthetic-demo-value");
});

test("password update atomically revokes prior sessions and keeps only its replacement", async () => {
  const repo = new DemoRepository();
  const [user, other] = await repo.listUsers();
  const old = await hashPassword("OriginalSynthetic2026");
  const next = await hashPassword("ReplacementSynthetic2026");
  await repo.updateUserPassword(user.userId, old);
  const session = async (userId: string) => ({ userId, tokenHash: await hashSessionToken(createSessionToken()), expiresAt: createSessionExpiry() });
  const a = await session(user.userId), b = await session(user.userId), c = await session(other.userId), replacement = await session(user.userId);
  await repo.createAuthSession(a, old.passwordHash);
  await repo.createAuthSession(b, old.passwordHash);
  await repo.createAuthSession(c);
  assert.ok(await repo.updateUserPassword(user.userId, next, { expectedPasswordHash: old.passwordHash, replacementSession: replacement }));
  assert.equal(await repo.getUserBySessionTokenHash(a.tokenHash), null);
  assert.equal(await repo.getUserBySessionTokenHash(b.tokenHash), null);
  assert.equal((await repo.getUserBySessionTokenHash(replacement.tokenHash))?.userId, user.userId);
  assert.equal((await repo.getUserBySessionTokenHash(c.tokenHash))?.userId, other.userId);
  assert.equal(await verifyPassword("OriginalSynthetic2026", (await repo.getUserCredential(user.userId))!), false);
  assert.equal(await verifyPassword("ReplacementSynthetic2026", (await repo.getUserCredential(user.userId))!), true);
  assert.equal(await repo.createAuthSession(a, old.passwordHash), false, "login verified before reset cannot mint a later session");
  assert.equal(await repo.updateUserPassword(user.userId, old, { expectedPasswordHash: old.passwordHash }), null);
  assert.ok(await repo.getUserBySessionTokenHash(replacement.tokenHash), "failed compare-and-set does not revoke the winner");
  await repo.updateUserPassword(user.userId, old);
  assert.equal(await repo.getUserBySessionTokenHash(replacement.tokenHash), null, "trusted maintenance reset also revokes sessions");
});

test("two concurrent password changes with the same credential snapshot have one winner", async () => {
  const repo = new DemoRepository();
  const user = (await repo.listUsers())[0];
  const old = await hashPassword("ConcurrentOriginal2026");
  await repo.updateUserPassword(user.userId, old);
  const [one, two] = await Promise.all([hashPassword("ConcurrentFirst2026"), hashPassword("ConcurrentSecond2026")]);
  const results = await Promise.all([one, two].map((value) => repo.updateUserPassword(user.userId, value, { expectedPasswordHash: old.passwordHash })));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await repo.updateUserPassword("missing-user", old), null);
  await assert.rejects(repo.updateUserPassword(user.userId, old, { replacementSession: { userId: "wrong-user", tokenHash: "synthetic", expiresAt: createSessionExpiry() } }));
});

test("a duplicate replacement token leaves credentials and all existing sessions intact", async () => {
  const repo = new DemoRepository();
  const [user, other] = await repo.listUsers();
  const old = await hashPassword("CollisionOriginal2026");
  const next = await hashPassword("CollisionReplacement2026");
  await repo.updateUserPassword(user.userId, old);
  const own = { userId: user.userId, tokenHash: "synthetic-own-token", expiresAt: createSessionExpiry() };
  const existing = { userId: other.userId, tokenHash: "synthetic-other-token", expiresAt: createSessionExpiry() };
  await repo.createAuthSession(own, old.passwordHash);
  await repo.createAuthSession(existing);
  await assert.rejects(repo.updateUserPassword(user.userId, next, {
    expectedPasswordHash: old.passwordHash,
    replacementSession: { ...existing, userId: user.userId }
  }), /unique/);
  await assert.rejects(repo.createAuthSession({ ...existing, userId: user.userId }, old.passwordHash), /unique/);
  assert.equal((await repo.getUserCredential(user.userId))?.passwordHash, old.passwordHash);
  assert.equal((await repo.getUserBySessionTokenHash(own.tokenHash))?.userId, user.userId);
  assert.equal((await repo.getUserBySessionTokenHash(existing.tokenHash))?.userId, other.userId);
});
