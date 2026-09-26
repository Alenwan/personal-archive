import assert from "node:assert/strict";
import test from "node:test";
import type { Sql } from "postgres";
import { DemoRepository } from "../src/server/repositories/memory";
import { PostgresRepository } from "../src/server/repositories/postgres";
import type { BackupSnapshot, CreateDocumentInput } from "../src/server/repositories/types";
import type { BackupScope, CaseRecord, DocumentRecord, ServiceDiscussionMessage } from "../src/shared/types";

async function createFixture(withCases = false) {
  const memory = new DemoRepository();
  const user = (await memory.listUsers())[0];
  const exampleCase = (await memory.listCases())[0];
  const closedCase: CaseRecord = { ...exampleCase, caseId: crypto.randomUUID(), status: "Closed" };
  const openCase: CaseRecord = { ...exampleCase, caseId: crypto.randomUUID(), status: "Active" };
  const cases = withCases ? [closedCase, openCase] : [];
  memory.listCases = async () => cases;
  const category = await memory.createArchiveCategory({ categoryId: crypto.randomUUID(), name: "家庭资料", createdBy: user.userId });
  const parent = await memory.createArchiveFolder({ folderId: crypto.randomUUID(), name: "资料", createdBy: user.userId });
  const child = await memory.createArchiveFolder({ folderId: crypto.randomUUID(), name: "阅读", parentFolderId: parent.folderId, createdBy: user.userId });
  const documentInput = (name: string, caseId: string | null = null): CreateDocumentInput => ({
    documentId: crypto.randomUUID(), caseId, fileName: name, originalFileName: name,
    fileSize: 9, mimeType: "text/plain", category: category.name, folderId: caseId ? null : child.folderId,
    r2ObjectKey: `archive/documents/${crypto.randomUUID()}/${name}`, uploadedBy: user.userId, notes: "Synthetic fixture"
  });
  const original = await memory.createDocument(documentInput("书稿.txt"));
  const version = await memory.createDocumentVersion(original.documentId, documentInput("书稿修订.txt"));
  assert.ok(version);
  const image = await memory.createDocument({ ...documentInput("插图.png"), mimeType: "image/png" });
  const trashed = await memory.createDocument(documentInput("回收站.txt"));
  await memory.softDeleteDocument(trashed.documentId, { retainObject: true });
  const root = await memory.createServiceDiscussionMessage({ createdBy: user.userId, title: "无业务关联阅读", bodyText: "Global note" });
  const reply = await memory.createServiceDiscussionMessage({ createdBy: user.userId, parentMessageId: root.messageId, bodyText: "Global reply with image" });
  await memory.createServiceDiscussionAttachment({ messageId: reply.messageId, documentId: image.documentId, inlineImage: true });
  // More than a UI page, including a reply, must survive snapshot selection.
  for (let index = 0; index < 101; index += 1) {
    await memory.createServiceDiscussionMessage({ createdBy: user.userId, bodyText: `Global note ${index}` });
  }
  const knowledgeInput = { title: "独立知识", type: "Reference" as const, status: "Verified" as const, component: "", summary: "", body: "Global knowledge body", createdBy: user.userId };
  const knowledge = await memory.createKnowledge(knowledgeInput);
  const deletedKnowledge = await memory.createKnowledge({ ...knowledgeInput, title: "Deleted knowledge" });
  await memory.softDeleteKnowledge(deletedKnowledge.knowledgeId);
  let closedDocument: DocumentRecord | undefined;
  let closedDiscussion: ServiceDiscussionMessage | undefined;
  let sharedKnowledgeId: string | undefined;
  if (withCases) {
    closedDocument = await memory.createDocument(documentInput("closed.txt", closedCase.caseId));
    await memory.createDocument(documentInput("open.txt", openCase.caseId));
    closedDiscussion = await memory.createServiceDiscussionMessage({ caseId: closedCase.caseId, createdBy: user.userId, bodyText: "Closed case note" });
    await memory.createServiceDiscussionMessage({ caseId: openCase.caseId, createdBy: user.userId, bodyText: "Open case note" });
    const shared = await memory.createKnowledge({
      ...knowledgeInput, title: "Shared case knowledge",
      links: [{ entityType: "service", entityId: closedCase.caseId }, { entityType: "service", entityId: openCase.caseId }]
    });
    sharedKnowledgeId = shared.knowledgeId;
    await memory.createKnowledge({ ...knowledgeInput, title: "Open only", sourceServiceId: openCase.caseId });
  }
  return { memory, cases, category, parent, child, original, version, image, trashed, root, reply, knowledge, deletedKnowledge, closedDocument, closedDiscussion, sharedKnowledgeId };
}

function snapshotContent(snapshot: BackupSnapshot) {
  return {
    cases: snapshot.cases.map((item) => item.caseId).sort(),
    documents: snapshot.documents.map((item) => [item.documentId, item.documentGroupId, item.versionNumber, item.isCurrentVersion, item.r2ObjectKey, item.folderId]).sort(),
    folders: snapshot.archiveFolders.map((item) => [item.folderId, item.parentFolderId ?? null, item.name]).sort(),
    categories: snapshot.archiveCategories.map((item) => [item.categoryId, item.name]).sort(),
    discussion: snapshot.discussion.map((item) => [item.messageId, item.parentMessageId, item.bodyText, item.attachments.map((attachment) => attachment.documentId)]).sort(),
    knowledge: snapshot.knowledge.map((item) => [item.knowledgeId, item.body]).sort(),
    metadataRows: snapshot.metadataRows
  };
}

function assertMetadataCount(snapshot: BackupSnapshot) {
  assert.equal(snapshot.metadataRows, Object.values(snapshot).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0));
}

test("backup without cases includes independent files, old versions, global notes/replies, Knowledge and directory metadata", async () => {
  const fixture = await createFixture();
  for (const scope of ["all-cases", "updated-since-last-run"] as const) {
    const snapshot = await fixture.memory.buildBackupSnapshot(scope);
    assert.equal(snapshot.cases.length, 0);
    assert.deepEqual(snapshot.documents.map((item) => item.documentId).sort(), [fixture.original.documentId, fixture.version.current.documentId, fixture.image.documentId].sort());
    assert.equal(snapshot.documents.find((item) => item.documentId === fixture.original.documentId)?.isCurrentVersion, false);
    assert.equal(snapshot.discussion.length, 103);
    assert.equal(snapshot.discussion.find((item) => item.messageId === fixture.reply.messageId)?.attachments[0]?.documentId, fixture.image.documentId);
    assert.deepEqual(snapshot.knowledge.map((item) => item.knowledgeId), [fixture.knowledge.knowledgeId]);
    assert.equal(snapshot.archiveFolders.find((item) => item.folderId === fixture.child.folderId)?.parentFolderId, fixture.parent.folderId);
    assert.ok(snapshot.archiveCategories.some((item) => item.categoryId === fixture.category.categoryId));
    assertMetadataCount(snapshot);
  }
  const tableExport = await fixture.memory.exportDatabaseTables();
  assert.equal(tableExport.tables.find((table) => table.tableName === "archive_folders")?.rowCount, 2);
  assert.ok(tableExport.tables.find((table) => table.tableName === "archive_categories")?.rows.some((row) => row.categoryId === fixture.category.categoryId));
});

test("closed-cases keeps its existing case selection and excludes newly supported independent content", async () => {
  const fixture = await createFixture(true);
  const closed = await fixture.memory.buildBackupSnapshot("closed-cases");
  assert.deepEqual(closed.cases.map((item) => item.caseId), [fixture.cases[0].caseId]);
  assert.deepEqual(closed.documents.map((item) => item.documentId), [fixture.closedDocument!.documentId]);
  assert.deepEqual(closed.discussion.map((item) => item.messageId), [fixture.closedDiscussion!.messageId]);
  assert.deepEqual(closed.knowledge.map((item) => item.knowledgeId), [fixture.sharedKnowledgeId]);
  assert.deepEqual(closed.archiveFolders, []);
  assert.deepEqual(closed.archiveCategories, []);
  const all = await fixture.memory.buildBackupSnapshot("all-cases");
  assert.equal(all.knowledge.filter((item) => item.knowledgeId === fixture.sharedKnowledgeId).length, 1);
  assertMetadataCount(closed);
  assertMetadataCount(all);
});

function snakeRecord(record: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
}

// No database or network is opened here. This adapter exercises the production
// SQL selection and row hydration contracts; a real PostgreSQL restore/integration
// run is separate and is not claimed by these tests.
async function postgresForFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const source = await fixture.memory.buildBackupSnapshot("all-cases");
  const queriedScopes: { documents: Array<string | null>; discussion: Array<string | null> } = { documents: [], discussion: [] };
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join("?").replace(/\s+/g, " ").trim();
    if (query.includes("from documents d") && query.includes("is not distinct from")) {
      assert.match(query, /coalesce\(d\.work_item_id, d\.case_id\) is not distinct from \?::uuid/);
      assert.match(query, /d\.deleted_at is null/);
      assert.doesNotMatch(query, /is_current_version\s*=\s*true|\blimit\b/);
      const scope = values[0] as string | null;
      queriedScopes.documents.push(scope);
      return source.documents.filter((item) => (item.caseId ?? null) === scope).map(snakeRecord);
    }
    if (query.includes("from service_discussion_messages sdm") && query.includes("is not distinct from")) {
      assert.match(query, /where sdm\.work_item_id is not distinct from \?::uuid and sdm\.deleted_at is null/);
      assert.doesNotMatch(query, /sdm\.parent_message_id is null|\blimit\b/);
      const scope = values.at(-1) as string | null;
      queriedScopes.discussion.push(scope);
      return source.discussion.filter((item) => (item.caseId ?? null) === scope).map((item) => ({ ...snakeRecord(item), work_item_id: item.caseId ?? null }));
    }
    if (query.includes("from service_discussion_attachments sda")) {
      const messageIds = values[0] as string[];
      return source.discussion.filter((item) => messageIds.includes(item.messageId)).flatMap((item) => item.attachments.map((attachment) => ({
        ...snakeRecord(attachment.document), ...snakeRecord(attachment), attachment_created_at: attachment.createdAt
      })));
    }
    if (query.includes("from tags t") || query.includes("from document_tags dt") || query.includes("from service_discussion_mentions sdm") || query.includes("from service_discussion_asset_links sdal")) return [];
    if (/select \* from private_vault(?:s|_folders|_items) order by created_at/.test(query)) return [];
    throw new Error(`Unexpected fixture SQL: ${query}`);
  };
  const postgres = new PostgresRepository(sql as unknown as Sql);
  postgres.listCases = fixture.memory.listCases.bind(fixture.memory);
  postgres.listTags = fixture.memory.listTags.bind(fixture.memory);
  postgres.listArchiveFolders = fixture.memory.listArchiveFolders.bind(fixture.memory);
  postgres.listArchiveCategories = fixture.memory.listArchiveCategories.bind(fixture.memory);
  postgres.listKnowledge = fixture.memory.listKnowledge.bind(fixture.memory);
  postgres.listPartyOrganizations = async () => [];
  postgres.listManuscripts = async () => [];
  postgres.listCaseContacts = async () => [];
  postgres.listTasks = async () => [];
  postgres.listNotes = async () => [];
  postgres.listCommunications = async () => [];
  postgres.listCaseAuditLogs = async () => [];
  return { postgres, queriedScopes };
}

for (const withCases of [false, true]) {
  for (const scope of ["all-cases", "updated-since-last-run", "closed-cases"] as BackupScope[]) {
    test(`PostgreSQL snapshot SQL/hydration matches memory: ${scope}, cases=${withCases}`, async () => {
      const fixture = await createFixture(withCases);
      const { postgres, queriedScopes } = await postgresForFixture(fixture);
      const actual = await postgres.buildBackupSnapshot(scope);
      const expected = await fixture.memory.buildBackupSnapshot(scope);
      assert.deepEqual(snapshotContent(actual), snapshotContent(expected));
      assert.equal(queriedScopes.documents.includes(null), scope !== "closed-cases");
      assert.equal(queriedScopes.discussion.includes(null), scope !== "closed-cases");
      assertMetadataCount(actual);
    });
  }
}
