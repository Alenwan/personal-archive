import assert from "node:assert/strict";
import type { AppRepository } from "../../src/server/repositories/types";

// Repository isolation underpins the HTTP role matrix. Marker payloads are used
// here; the HTTP fixture separately encrypts and decrypts real synthetic bytes.
export async function vaultScopeContract(repo: AppRepository, ownerUserId: string, otherUserId: string) {
  async function create(owner: string) {
    const vault = await repo.createPrivateVault({ vaultId: crypto.randomUUID(), ownerUserId: owner,
      encryptionVersion: 1, encryptionKdf: "PBKDF2-SHA-256", encryptionIterations: 600000,
      encryptionSalt: "synthetic", encryptedVaultKey: "synthetic", recoveryEncryptedVaultKey: "synthetic" });
    const folder = await repo.createPrivateVaultFolder({ folderId: crypto.randomUUID(), vaultId: vault.vaultId,
      encryptionVersion: 1, encryptedMetadata: "synthetic folder metadata" });
    const item = await repo.createPrivateVaultItem({ itemId: crypto.randomUUID(), vaultId: vault.vaultId,
      encryptionVersion: 1, encryptedMetadata: "synthetic original metadata", wrappedFileKey: "synthetic",
      objectKey: `synthetic-vault-scope/${crypto.randomUUID()}`, ciphertextSize: 4 });
    return { owner, vault, folder, item };
  }
  const a = await create(ownerUserId), b = await create(otherUserId);
  for (const [own, other] of [[a, b], [b, a]]) {
    assert.equal(await repo.getPrivateVaultItem(own.owner, other.item.itemId, true), null);
    assert.equal(await repo.getPrivateVaultFolder(own.owner, other.folder.folderId, true), null);
    assert.deepEqual((await repo.listPrivateVaultItems(own.owner)).map((item) => item.itemId), [own.item.itemId]);
    assert.deepEqual((await repo.listPrivateVaultFolders(own.owner)).map((item) => item.folderId), [own.folder.folderId]);
    await assert.rejects(repo.updatePrivateVaultItemMetadataBatch(own.owner, [
      { itemId: own.item.itemId, encryptedMetadata: "synthetic should roll back" },
      { itemId: other.item.itemId, encryptedMetadata: "synthetic forbidden" }
    ]));
    assert.deepEqual(await repo.getPrivateVaultItem(own.owner, own.item.itemId), own.item);
    assert.equal(await repo.updatePrivateVaultItemMetadata(own.owner, other.item.itemId, "forbidden"), null);
    assert.equal(await repo.updatePrivateVaultFolderMetadata(own.owner, other.folder.folderId, "forbidden"), null);
    await repo.softDeletePrivateVaultItem(other.owner, other.item.itemId);
    await repo.softDeletePrivateVaultFolder(other.owner, other.folder.folderId);
    assert.deepEqual((await repo.listPrivateVaultItems(other.owner, true)).map((item) => item.itemId), [other.item.itemId]);
    assert.deepEqual(await repo.listPrivateVaultItems(own.owner, true), []);
    assert.equal(await repo.restorePrivateVaultItem(own.owner, other.item.itemId), null);
    assert.equal(await repo.restorePrivateVaultFolder(own.owner, other.folder.folderId), null);
    assert.equal(await repo.purgePrivateVaultItem(own.owner, other.item.itemId), null);
    assert.equal(await repo.purgePrivateVaultFolder(own.owner, other.folder.folderId), null);
    assert.ok(await repo.restorePrivateVaultItem(other.owner, other.item.itemId));
    assert.ok(await repo.restorePrivateVaultFolder(other.owner, other.folder.folderId));
    other.item = (await repo.getPrivateVaultItem(other.owner, other.item.itemId))!;
  }
  // Avoid leaving inert object markers in the later full-recovery inventory.
  for (const f of [a, b]) {
    await repo.softDeletePrivateVaultItem(f.owner, f.item.itemId);
    assert.ok(await repo.purgePrivateVaultItem(f.owner, f.item.itemId));
  }
}
