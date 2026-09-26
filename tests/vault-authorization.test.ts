import assert from "node:assert/strict";
import test from "node:test";
import { app } from "../functions/api/[[path]]";
import { createRepository } from "../src/server/repositories/factory";
import { createDocumentStorage } from "../src/server/storage/documentStorage";
import { hashPassword } from "../src/server/auth/password";
import { createPrivateVaultEncryption, encryptPrivateVaultFile, decryptPrivateVaultItemMetadata, decryptPrivateVaultBlob, encryptPrivateVaultFolderMetadata } from "../src/shared/privateVaultEncryption";
import { wrapPrivateVaultRecoveryKey } from "../src/server/services/privateVaultRecoveryCrypto";
import type { AppEnv } from "../src/server/env";
import type { PublicUser } from "../src/shared/types";
import { DemoRepository } from "../src/server/repositories/memory";
import { vaultScopeContract } from "./helpers/vaultScopeContract";

const env: AppEnv = { APP_ENV: "test", BUSINESS_TEMPLATE: "personal-archive", DEMO_MODE: "false", PUBLIC_DEMO_READONLY: "false",
  PRIVATE_VAULT_RECOVERY_KEY: `synthetic-${crypto.randomUUID()}-${crypto.randomUUID()}` };
const repo = createRepository(env);
const password = "SyntheticAccount2026";
test("memory Vault ownership and batch rollback match the PostgreSQL contract", async () => {
  const memory = new DemoRepository();
  const [owner, other] = await memory.listUsers();
  await vaultScopeContract(memory, owner.userId, other.userId);
});
async function request(path: string, method = "GET", body?: unknown, cookie?: string) {
  return app.request(`/api${path}`, { method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
}
async function fixture(role: PublicUser["role"]) {
  const user = (await repo.listUsers()).find((item) => item.role === role)!;
  await repo.updateUserPassword(user.userId, await hashPassword(password));
  const login = await request("/auth/login", "POST", { email: user.email, password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const encryption = await createPrivateVaultEncryption("SyntheticIndependentVaultPassword");
  const vaultId = crypto.randomUUID();
  const vault = await repo.createPrivateVault({ ...encryption.metadata, vaultId, ownerUserId: user.userId,
    recoveryEncryptedVaultKey: await wrapPrivateVaultRecoveryKey(encryption.recoveryVaultKey, vaultId, user.userId, env) });
  const itemId = crypto.randomUUID();
  const file = await encryptPrivateVaultFile(encryption.vaultKey, vaultId, itemId, new File([`Synthetic ${role} private body`], "private.txt", { type: "text/plain" }));
  const item = await repo.createPrivateVaultItem({ itemId, vaultId, encryptionVersion: 1, encryptedMetadata: file.encryptedMetadata,
    wrappedFileKey: file.wrappedFileKey, objectKey: `synthetic-vault/${itemId}`, ciphertextSize: file.encryptedFile.size });
  await createDocumentStorage(env).put(item.objectKey, await file.encryptedFile.arrayBuffer(), file.encryptedFile.type);
  const folderId = crypto.randomUUID();
  const folder = await repo.createPrivateVaultFolder({ folderId, vaultId, encryptionVersion: 1,
    encryptedMetadata: encryptPrivateVaultFolderMetadata(encryption.vaultKey, vaultId, folderId, { name: "Synthetic folder", parentFolderId: null, favorite: false }) });
  return { user, cookie, vault, item, folder, encryption };
}

test("ReadOnly cannot mutate any Vault route, including key recovery, multipart and future endpoints", async () => {
  const f = await fixture("ReadOnly");
  const base = "/private-vault";
  const writes = [[base, "POST"], [`${base}/key`, "PATCH"], [`${base}/reset-password`, "POST"], [`${base}/settings`, "PATCH"],
    [`${base}/folders`, "POST"], [`${base}/folders/${f.folder.folderId}`, "PATCH"], [`${base}/folders/${f.folder.folderId}`, "DELETE"],
    [`${base}/folders/${f.folder.folderId}/restore`, "POST"], [`${base}/folders/${f.folder.folderId}/permanent`, "DELETE"],
    [`${base}/items`, "POST"], [`${base}/items`, "PATCH"], [`${base}/items/${f.item.itemId}`, "PATCH"],
    [`${base}/items/${f.item.itemId}`, "DELETE"], [`${base}/items/${f.item.itemId}/restore`, "POST"],
    [`${base}/items/${f.item.itemId}/permanent`, "DELETE"], [`${base}/future-route`, "POST"]];
  for (const [path, method] of writes) {
    assert.equal((await request(path, method, {}, f.cookie)).status, 403, `${method} ${path}`);
    assert.equal((await request(path, method, {})).status, 401);
  }
  for (const suffix of ["", "/items", "/items?trash=true", "/folders", "/folders?trash=true"]) {
    assert.equal((await request(`${base}${suffix}`, "GET", undefined, f.cookie)).status, 200);
  }
  const blob = await request(`${base}/items/${f.item.itemId}/blob`, "GET", undefined, f.cookie);
  assert.equal(blob.status, 200);
  const metadata = decryptPrivateVaultItemMetadata(f.encryption.vaultKey, f.item);
  assert.equal(await decryptPrivateVaultBlob(f.encryption.vaultKey, f.item, await blob.arrayBuffer(), metadata).text(), "Synthetic ReadOnly private body");
  assert.deepEqual(await repo.getPrivateVaultByOwner(f.user.userId), f.vault);
  assert.deepEqual(await repo.getPrivateVaultItem(f.user.userId, f.item.itemId), f.item);
});

test("Admin, Manager and Staff use only their own Vault; mixed-owner batches leave all objects unchanged", async () => {
  const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
  for (const role of ["Admin", "Manager", "Staff"] as const) fixtures.push(await fixture(role));
  for (const f of fixtures) {
    const other = fixtures.find((candidate) => candidate.user.userId !== f.user.userId)!;
    const paths = [`/private-vault/items/${other.item.itemId}`, `/private-vault/folders/${other.folder.folderId}`];
    assert.equal((await request(`/private-vault/items/${other.item.itemId}/blob`, "GET", undefined, f.cookie)).status, 404);
    const list = await (await request("/private-vault/items", "GET", undefined, f.cookie)).json() as Array<{ itemId: string }>;
    assert.deepEqual(list.map((item) => item.itemId), [f.item.itemId]);
    for (const path of paths) {
      const metadata = path.includes("/folders/") ? other.folder.encryptedMetadata : other.item.encryptedMetadata;
      assert.equal((await request(path, "PATCH", { encryptedMetadata: metadata }, f.cookie)).status, 404);
      assert.equal((await request(path, "DELETE", undefined, f.cookie)).status, 404);
      assert.equal((await request(`${path}/restore`, "POST", {}, f.cookie)).status, 404);
      assert.equal((await request(`${path}/permanent`, "DELETE", undefined, f.cookie)).status, 409);
    }
    const batch = await request("/private-vault/items", "PATCH", { updates: [
      { itemId: f.item.itemId, encryptedMetadata: other.item.encryptedMetadata },
      { itemId: other.item.itemId, encryptedMetadata: f.item.encryptedMetadata }
    ] }, f.cookie);
    assert.equal(batch.status, 404);
    assert.deepEqual(await repo.getPrivateVaultItem(f.user.userId, f.item.itemId), f.item);
    assert.deepEqual(await repo.getPrivateVaultItem(other.user.userId, other.item.itemId), other.item);
    assert.equal((await request("/private-vault/settings", "PATCH", { autoLockMinutes: 30 }, f.cookie)).status, 200);
    assert.equal((await request(`/private-vault/items/${f.item.itemId}`, "PATCH", { encryptedMetadata: f.item.encryptedMetadata }, f.cookie)).status, 200);
    // Refresh the expected own record after a legitimate update for later iterations.
    f.item = (await repo.getPrivateVaultItem(f.user.userId, f.item.itemId))!;
  }
});
