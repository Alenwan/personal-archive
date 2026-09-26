import { HTTPException } from "hono/http-exception";
import type { ArchiveFolder, DocumentRecord, PublicUser } from "../../shared/types";
import type { AppRepository } from "../repositories/types";
import { requirePermission } from "./permissions";
import { archiveDocumentCandidates, archiveInlineDocumentIds, type ArchiveContentKind } from "../../shared/archiveContent";
import { isEncryptedManuscriptBody } from "../../shared/manuscriptEncryption";

export const ARCHIVE_MANAGEMENT_TTL_MS = 5 * 60 * 1000;
export interface ArchiveAccess { userId: string; sessionTokenHash: string }
export interface ArchiveManagementSession { user: PublicUser; verifiedUntil: string | null }
export interface ArchiveManagementTarget { kind: string; id: string; ownerUserId: string | null }
export interface ArchiveManagementState {
  folders: ArchiveFolder[];
  documents: Array<Pick<DocumentRecord, "documentId" | "documentGroupId" | "managementOwnerUserId" | "folderId" | "deletedAt" | "folderDeletionBatchId" | "isCurrentVersion">>;
  references: Array<ArchiveManagementTarget & { documentId: string }>;
}
export const archiveMutationMethods = [
  "createDocument", "createDocumentVersion", "updateDocument", "softDeleteDocument", "restoreDocument", "purgeDocument",
  "createArchiveFolder", "updateArchiveFolder", "deleteArchiveFolder", "restoreArchiveFolder", "updateArchiveFolderDocumentsMetadata",
  "updateArchiveCategory", "deleteArchiveCategory", "createServiceDiscussionAttachment", "createDocumentWithDiscussionAttachment",
  "linkAssetDocument", "updateAssetDocumentLink", "deleteAssetDocumentLink",
  "linkServiceDiscussionThread", "updateServiceDiscussionThreadContext",
  "createServiceDiscussionMessage", "updateServiceDiscussionMessage", "softDeleteServiceDiscussionMessage",
  "linkServiceDiscussionAsset", "unlinkServiceDiscussionAsset",
  "createKnowledge", "updateKnowledge", "softDeleteKnowledge", "restoreKnowledge", "purgeKnowledge",
  "createManuscript", "updateManuscript", "softDeleteManuscript",
  "createManuscriptChapter", "updateManuscriptChapter", "deleteManuscriptChapter", "createManuscriptDocument",
  "replaceManuscriptBodyEncryption", "updateManuscriptEncryptionKey"
] as const satisfies readonly (keyof AppRepository)[];
type ArchiveMethod = typeof archiveMutationMethods[number];
type Mutation = { [K in ArchiveMethod]: { method: K; args: Parameters<AppRepository[K]> } }[ArchiveMethod];

export function requireArchiveSession(session: ArchiveManagementSession | null, access: ArchiveAccess): ArchiveManagementSession {
  if (!session || session.user.userId !== access.userId || session.user.mustChangePassword) {
    throw new HTTPException(403, { message: "Archive session changed. Sign in again before managing files." });
  }
  return session;
}

/** Called only inside runArchiveMutation: authorization, write and audit share a transaction. */
async function authorize(repo: AppRepository, access: ArchiveAccess, mutation: Mutation) {
  const { user, verifiedUntil } = requireArchiveSession(await repo.getArchiveManagementSession(access), access);
  const contentCreate = ["createServiceDiscussionMessage", "updateServiceDiscussionMessage", "softDeleteServiceDiscussionMessage",
    "linkServiceDiscussionAsset", "unlinkServiceDiscussionAsset", "createKnowledge", "createManuscript", "createManuscriptChapter"].includes(mutation.method);
  const upload = ["createDocument", "createDocumentVersion", "createServiceDiscussionAttachment", "createDocumentWithDiscussionAttachment", "createManuscriptDocument"].includes(mutation.method);
  requirePermission(user, contentCreate ? "create" : upload ? "upload" : "edit", contentCreate ? "note" : "document");
  const targets: ArchiveManagementTarget[] = [];
  const targetFolder = async (id?: string | null) => {
    if (!id) return;
    const folder = await repo.getArchiveFolder(id, { includeDeleted: true });
    if (folder) targets.push({ kind: "folder", id, ownerUserId: folder.managementOwnerUserId ?? null });
  };
  const targetDocuments = (state: ArchiveManagementState, ids: Set<string>) => {
    const documentIds = new Set<string>();
    for (const doc of state.documents.filter((d) => ids.has(d.documentGroupId))) {
      targets.push({ kind: "document-group", id: doc.documentGroupId, ownerUserId: doc.managementOwnerUserId ?? null });
      documentIds.add(doc.documentId);
    }
    targets.push(...state.references.filter((ref) => documentIds.has(ref.documentId)));
  };
  const targetDocument = async (id: string) => {
    const state = await repo.readArchiveManagementState(id);
    targetDocuments(state, new Set(state.documents.map((doc) => doc.documentGroupId)));
    return state;
  };
  const targetContent = async (kind: ArchiveContentKind, id: string, wholeThread = false) => {
    targets.push(...await repo.readArchiveContentTargets(kind, id, wholeThread));
  };
  const newReferences = async (kind: ArchiveContentKind, id: string | null, body = "", linkedIds: string[] = []) => {
    const existing = new Set(id ? await repo.readArchiveContentDocumentIds(kind, id) : []);
    const candidates = [...new Set([...archiveDocumentCandidates(body), ...linkedIds])].filter((docId) => !existing.has(docId));
    if (candidates.length > 1000) throw new HTTPException(422, { message: "Too many new document references in one change." });
    const required = new Set([...archiveInlineDocumentIds(body), ...linkedIds]);
    for (const docId of candidates) {
      const state = await targetDocument(docId);
      if (required.has(docId) && !state.documents.some((d) => d.documentId === docId && !d.deletedAt)) {
        throw new HTTPException(409, { message: "A newly referenced file is missing or in trash. Restore it before attaching it to content." });
      }
    }
  };
  const creator = (createdBy?: string | null) => {
    if (createdBy !== user.userId) throw new HTTPException(403, { message: "The content creator must be the current account." });
  };
  const chapterState = async (id: string, body: string | undefined) => {
    const work = await repo.getManuscript(id);
    if (work && body !== undefined && work.encryptionEnabled !== isEncryptedManuscriptBody(body.trim())) {
      throw new HTTPException(409, { message: "Writing encryption changed. Reload before saving this chapter." });
    }
    return work;
  };
  switch (mutation.method) {
    case "createServiceDiscussionMessage":
      creator(mutation.args[0].createdBy);
      await newReferences("discussion", null, mutation.args[0].bodyText);
      break;
    case "updateServiceDiscussionMessage": {
      const [id, input] = mutation.args;
      await targetContent("discussion", id, input.threadStatus !== undefined || input.threadOwnerUserId !== undefined);
      await newReferences("discussion", id, input.bodyText);
      break;
    }
    case "softDeleteServiceDiscussionMessage":
    case "unlinkServiceDiscussionAsset":
      await targetContent("discussion", mutation.args[0]);
      break;
    case "linkServiceDiscussionAsset":
      await targetContent("discussion", mutation.args[0].messageId);
      break;
    case "createKnowledge":
      creator(mutation.args[0].createdBy);
      await newReferences("knowledge", null, mutation.args[0].body, mutation.args[0].links?.filter((l) => l.entityType === "document").map((l) => l.entityId));
      break;
    case "updateKnowledge":
      await targetContent("knowledge", mutation.args[0]);
      await newReferences("knowledge", mutation.args[0], mutation.args[1].body, mutation.args[1].links?.filter((l) => l.entityType === "document").map((l) => l.entityId));
      break;
    case "softDeleteKnowledge":
    case "restoreKnowledge":
    case "purgeKnowledge":
      await targetContent("knowledge", mutation.args[0]);
      break;
    case "createManuscript":
      creator(mutation.args[0].createdBy);
      break;
    case "updateManuscript":
    case "softDeleteManuscript":
      await targetContent("manuscript", mutation.args[0]);
      break;
    case "createManuscriptChapter": {
      const [input] = mutation.args;
      await targetContent("manuscript", input.manuscriptId);
      await chapterState(input.manuscriptId, input.body ?? "");
      await newReferences("manuscript", input.manuscriptId, input.body);
      break;
    }
    case "updateManuscriptChapter":
      await targetContent("manuscript", mutation.args[0]);
      await chapterState(mutation.args[0], mutation.args[2].body);
      await newReferences("manuscript", mutation.args[0], mutation.args[2].body);
      break;
    case "deleteManuscriptChapter": {
      await targetContent("manuscript", mutation.args[0]);
      const work = await repo.getManuscript(mutation.args[0]);
      if (work && work.chapterCount <= 1) throw new HTTPException(409, { message: "Keep at least one chapter in the work." });
      break;
    }
    case "createManuscriptDocument": {
      const [id, input] = mutation.args;
      if (input.uploadedBy !== user.userId || (input.documentGroupId && input.documentGroupId !== input.documentId)
        || (input.versionNumber !== undefined && input.versionNumber !== 1)) throw new HTTPException(403, { message: "Inline images must begin an independently owned version group." });
      if (!(await repo.getManuscript(id))) throw new HTTPException(404, { message: "Manuscript not found." });
      await targetContent("manuscript", id);
      await targetFolder(input.folderId);
      break;
    }
    case "replaceManuscriptBodyEncryption":
    case "updateManuscriptEncryptionKey": {
      const work = await repo.getManuscript(mutation.args[0]);
      if (!work || work.keyOwnerUserId !== user.userId) throw new HTTPException(403, { message: "Only the confirmed writing key owner may manage encryption." });
      // Administrative management never substitutes for confirmed key authority.
      if (mutation.method === "replaceManuscriptBodyEncryption") {
        for (const item of [...mutation.args[1].chapters, ...mutation.args[1].versions]) await newReferences("manuscript", work.manuscriptId, item.body);
      }
      break;
    }
    case "createDocument": {
      const [input] = mutation.args;
      if (input.uploadedBy !== user.userId || (input.documentGroupId && input.documentGroupId !== input.documentId)
        || (input.versionNumber !== undefined && input.versionNumber !== 1)) {
        throw new HTTPException(403, { message: "New files must begin an independently owned version group." });
      }
      await targetFolder(input.folderId);
      break;
    }
    case "createDocumentVersion":
    case "updateDocument":
    case "softDeleteDocument":
    case "restoreDocument":
    case "purgeDocument": {
      const state = await targetDocument(mutation.args[0]);
      const source = state.documents.find((doc) => doc.documentId === mutation.args[0]);
      if (mutation.method === "createDocumentVersion" || mutation.method === "updateDocument") {
        const input = mutation.args[1];
        if (mutation.method === "createDocumentVersion" && mutation.args[1].uploadedBy !== user.userId) {
          throw new HTTPException(403, { message: "The uploader must be the current account." });
        }
        if (input.folderId !== undefined && input.folderId !== source?.folderId) await targetFolder(input.folderId);
      }
      if (mutation.method === "restoreDocument") await targetFolder(source?.folderId);
      if (mutation.method === "purgeDocument" && state.references.length) {
        throw new HTTPException(409, { message: "Referenced files cannot be permanently deleted. Their content references must be resolved first." });
      }
      break;
    }
    case "createArchiveFolder": {
      const [input] = mutation.args;
      if (input.createdBy !== user.userId) throw new HTTPException(403, { message: "The folder creator must be the current account." });
      await targetFolder(input.parentFolderId);
      break;
    }
    case "updateArchiveFolder":
    case "deleteArchiveFolder":
    case "restoreArchiveFolder":
    case "updateArchiveFolderDocumentsMetadata": {
      const [id] = mutation.args;
      const state = await repo.readArchiveManagementState(undefined, id);
      const root = state.folders.find((folder) => folder.folderId === id);
      if (!root) break;
      const restoring = mutation.method === "restoreArchiveFolder";
      let folders = [root];
      if (restoring) {
        folders = state.folders.filter((folder) => folder.deletedAt && root.deletionBatchId && folder.deletionBatchId === root.deletionBatchId);
      } else if (mutation.method !== "updateArchiveFolderDocumentsMetadata" || mutation.args[1].includeSubfolders) {
        const ids = new Set([id]);
        for (let size = -1; size !== ids.size;) {
          size = ids.size;
          for (const f of state.folders) if (!f.deletedAt && f.parentFolderId && ids.has(f.parentFolderId)) ids.add(f.folderId);
        }
        folders = state.folders.filter((f) => ids.has(f.folderId) && !f.deletedAt);
      }
      for (const f of folders) targets.push({ kind: "folder", id: f.folderId, ownerUserId: f.managementOwnerUserId ?? null });
      // Always authorize the requested root, including invalid/trashed requests.
      await targetFolder(id);
      const folderIds = new Set(folders.map((f) => f.folderId));
      const affected = state.documents.filter((d) => restoring
        ? d.deletedAt && root.deletionBatchId && d.folderDeletionBatchId === root.deletionBatchId
        : !d.deletedAt && d.folderId && folderIds.has(d.folderId)
          && (mutation.method !== "updateArchiveFolderDocumentsMetadata" || d.isCurrentVersion));
      targetDocuments(state, new Set(affected.map((d) => d.documentGroupId)));
      if (mutation.method === "updateArchiveFolder" || mutation.method === "restoreArchiveFolder") {
        const next = mutation.args[1]?.parentFolderId;
        if (restoring || next !== undefined) await targetFolder(next === undefined ? root.parentFolderId : next);
      }
      break;
    }
    case "createServiceDiscussionAttachment": {
      const [input] = mutation.args;
      const message = await repo.getServiceDiscussionMessage(input.messageId);
      if (!message) throw new HTTPException(404, { message: "Discussion message not found." });
      targets.push({ kind: "discussion", id: message.messageId, ownerUserId: message.managementOwnerUserId ?? null });
      await targetDocument(input.documentId);
      break;
    }
    case "createDocumentWithDiscussionAttachment": {
      const [document, attachment] = mutation.args;
      if (document.uploadedBy !== user.userId || (document.documentGroupId && document.documentGroupId !== document.documentId)
        || (document.versionNumber !== undefined && document.versionNumber !== 1)) {
        throw new HTTPException(403, { message: "Attachments must begin an independently owned version group." });
      }
      const message = await repo.getServiceDiscussionMessage(attachment.messageId);
      if (!message) throw new HTTPException(404, { message: "Discussion message not found." });
      targets.push({ kind: "discussion", id: message.messageId, ownerUserId: message.managementOwnerUserId ?? null });
      await targetFolder(document.folderId);
      break;
    }
    case "linkAssetDocument":
    case "updateAssetDocumentLink":
    case "deleteAssetDocumentLink": {
      const link = mutation.method === "linkAssetDocument" ? mutation.args[0] : await repo.getAssetDocumentLink(mutation.args[0]);
      if (!link) break;
      const asset = await repo.getAsset(link.assetId);
      targets.push({ kind: "asset", id: link.assetId, ownerUserId: asset?.createdBy ?? null });
      await targetDocument(link.documentId);
      break;
    }
    // These operations can rewrite many documents through inherited case/thread
    // relationships. Reserve them for audited administration until content ACLs
    // replace the inherited workflow as a whole.
    case "linkServiceDiscussionThread":
    case "updateServiceDiscussionThreadContext":
      targets.push({ kind: "discussion-context", id: mutation.args[0], ownerUserId: null });
      break;
    case "updateArchiveCategory":
    case "deleteArchiveCategory":
      targets.push({ kind: "archive-category", id: mutation.args[0], ownerUserId: null });
      break;
  }
  const foreign = [...new Map(targets.filter((target) => target.ownerUserId !== user.userId)
    .map((target) => [`${target.kind}:${target.id}:${target.ownerUserId}`, target])).values()];
  if (foreign.length && user.role !== "Admin") {
    throw new HTTPException(403, { message: "You can only manage your own files, folders and content. Ask an administrator to manage shared content." });
  }
  if (foreign.length && (!verifiedUntil || Date.parse(verifiedUntil) <= Date.now())) {
    throw new HTTPException(403, { message: "Verify your password using Manage shared content before managing another account's or unresolved content." });
  }
  if (mutation.method === "purgeDocument" && await repo.hasOpaqueArchiveContent()) {
    throw new HTTPException(409, { message: "Permanent file cleanup is paused while encrypted writing references cannot be reviewed. Files can still be trashed and restored." });
  }
  return foreign;
}

export function withArchiveManagementAccess(repo: AppRepository, access: ArchiveAccess): AppRepository {
  return new Proxy(repo, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (!(archiveMutationMethods as readonly PropertyKey[]).includes(property)) return value.bind(target);
      return (...args: unknown[]) => target.runArchiveMutation(access, async (transaction) => {
        const method = property as ArchiveMethod;
        const foreign = await authorize(transaction, access, { method, args } as Mutation);
        const operation = transaction[method] as (...values: unknown[]) => Promise<unknown>;
        const result = await operation.apply(transaction, args);
        // An audit failure rejects the entire metadata change.
        if (foreign.length) await transaction.recordArchiveManagementAudit(access.userId, method, foreign);
        return result;
      });
    }
  });
}
