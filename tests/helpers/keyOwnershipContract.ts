import assert from "node:assert/strict";
import type { AppRepository } from "../../src/server/repositories/types";
import { createManuscriptEncryption, encryptManuscriptBody, unlockManuscriptWithPassword, decryptManuscriptBody } from "../../src/shared/manuscriptEncryption";

export async function keyOwnershipContract(repo: AppRepository, ownerUserId: string, otherUserId: string) {
  const input = { title: "Synthetic ownership work", kind: "Novel" as const, status: "Draft" as const, description: "" };
  const owned = await repo.createManuscript({ ...input, createdBy: ownerUserId });
  assert.equal(owned.keyOwnerUserId, ownerUserId);
  await repo.updateManuscript(owned.manuscriptId, { title: "Another editor", updatedBy: otherUserId });
  assert.equal((await repo.getManuscript(owned.manuscriptId))?.keyOwnerUserId, ownerUserId);
  assert.ok(!(await repo.listUnresolvedManuscriptKeyOwnership()).some((item) => item.manuscriptId === owned.manuscriptId));
  await assert.rejects(repo.createManuscript({ ...input, createdBy: crypto.randomUUID() }));

  const legacy = await repo.createManuscript(input);
  const encryption = await createManuscriptEncryption("SyntheticIndependentPassword");
  const chapter = await repo.getManuscriptChapter(legacy.manuscriptId, legacy.chapters[0].chapterId);
  assert.ok(chapter);
  const cipher = await encryptManuscriptBody(encryption.workKey, legacy.manuscriptId, chapter.chapterId, "Unresolved ownership must not destroy this body");
  await repo.replaceManuscriptBodyEncryption(legacy.manuscriptId, {
    chapters: [{ chapterId: chapter.chapterId, expectedRevision: chapter.revision, body: cipher }], versions: [],
    metadata: { ...encryption.metadata, recoveryEncryptedWorkKey: "synthetic-maintenance-envelope" }
  }, true);
  const protectedWork = await repo.getManuscript(legacy.manuscriptId);
  assert.ok(protectedWork && !protectedWork.keyOwnerUserId);
  const originalKey = await unlockManuscriptWithPassword(protectedWork, "SyntheticIndependentPassword");
  assert.equal(await decryptManuscriptBody(originalKey, legacy.manuscriptId, chapter.chapterId, cipher), "Unresolved ownership must not destroy this body");
  const review = (await repo.listUnresolvedManuscriptKeyOwnership()).find((item) => item.manuscriptId === legacy.manuscriptId)!;
  assert.ok(review.encryptionEnabled);
  assert.deepEqual(Object.keys(review).sort(), ["createdBy", "deleted", "encryptionEnabled", "expectedUpdatedAt", "manuscriptId"]);
  const claim = { manuscriptId: legacy.manuscriptId, ownerUserId, expectedUpdatedAt: review.expectedUpdatedAt,
    evidenceReference: "synthetic-review/0001", operatorReference: "synthetic-maintainer" };
  await assert.rejects(repo.claimManuscriptKeyOwner({ ...claim, ownerUserId: crypto.randomUUID() }));
  await assert.rejects(repo.claimManuscriptKeyOwner({ ...claim, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }));
  await assert.rejects(repo.claimManuscriptKeyOwner({ ...claim, evidenceReference: "" }));
  assert.equal((await repo.getManuscript(legacy.manuscriptId))?.keyOwnerUserId, null);
  const outcomes = await Promise.allSettled([repo.claimManuscriptKeyOwner(claim), repo.claimManuscriptKeyOwner({ ...claim, ownerUserId: otherUserId })]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
  await assert.rejects(repo.claimManuscriptKeyOwner(claim));
  const saved = (await repo.getManuscript(legacy.manuscriptId))!;
  assert.ok([ownerUserId, otherUserId].includes(saved.keyOwnerUserId!));
  assert.equal(saved.encryptedWorkKey, protectedWork.encryptedWorkKey);
  assert.equal(saved.recoveryEncryptedWorkKey, protectedWork.recoveryEncryptedWorkKey);
  assert.equal((await repo.getManuscriptChapter(legacy.manuscriptId, chapter.chapterId))?.body, cipher);
  assert.deepEqual(await unlockManuscriptWithPassword(saved, "SyntheticIndependentPassword"), originalKey);
  const claims = (await repo.exportDatabaseTables()).tables.find((table) => table.tableName === "manuscript_key_owner_claims")!;
  const rows = claims.rows.filter((row) => row.manuscript_id === legacy.manuscriptId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner_user_id, saved.keyOwnerUserId);
  assert.equal(rows[0].evidence_reference, claim.evidenceReference);
  assert.ok(rows[0].recorded_by);
}
