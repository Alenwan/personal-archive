import assert from "node:assert/strict";
import test from "node:test";
import { requireManuscriptKeyOwner } from "../src/server/auth/manuscriptPermissions";
import type { Manuscript, PublicUser } from "../src/shared/types";
import { DemoRepository } from "../src/server/repositories/memory";
import { keyOwnershipContract } from "./helpers/keyOwnershipContract";

test("PA key authority comes from a confirmed owner, never historical authorship or Admin", () => {
  const author = { userId: "author", role: "Manager" } as PublicUser;
  const owner = { userId: "owner", role: "Manager" } as PublicUser;
  const admin = { userId: "admin", role: "Admin" } as PublicUser;
  const work = { createdBy: author.userId, keyOwnerUserId: owner.userId } as Manuscript;
  requireManuscriptKeyOwner(owner, work, true);
  for (const user of [author, admin]) assert.throws(() => requireManuscriptKeyOwner(user, work, true));
  for (const user of [author, owner, admin]) assert.throws(() => requireManuscriptKeyOwner(user, { ...work, keyOwnerUserId: null }, true));
  requireManuscriptKeyOwner(author, work, false);
  assert.throws(() => requireManuscriptKeyOwner(owner, null, true));
});

test("memory preserves key ownership, original passwords and atomic audited claims", async () => {
  const repo = new DemoRepository();
  const [owner, other] = await repo.listUsers();
  await keyOwnershipContract(repo, owner.userId, other.userId);
});
