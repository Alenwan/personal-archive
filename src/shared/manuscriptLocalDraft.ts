import type { ManuscriptChapterFormat } from "./types";

export interface ManuscriptLocalDraft {
  manuscriptId: string; chapterId: string; title: string; body: string;
  contentFormat: ManuscriptChapterFormat; baseUpdatedAt: string; savedAt: string; encrypted?: boolean;
}
export interface DraftScope { instanceId: string; userId: string }
type StoredDraft = { key: string; scope: string; draft: ManuscriptLocalDraft };
const STORE = "account-manuscript-drafts-v2";
const PREFIX = "personal-archive.manuscript-draft.v2.";
const memory = new Map<string, StoredDraft>();
let databasePromise: Promise<IDBDatabase> | null = null;

export function draftScopeKey(scope: DraftScope): string {
  if (!scope.instanceId || !scope.userId) throw new Error("A signed-in account and instance are required for local drafts.");
  return JSON.stringify([scope.instanceId, scope.userId]);
}
function keyFor(scope: DraftScope, manuscriptId: string, chapterId: string) {
  return JSON.stringify([draftScopeKey(scope), manuscriptId, chapterId]);
}
function localKey(key: string) { return PREFIX + key; }
function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable"));
      // Keep the old unassigned store intact. It must never be auto-adopted by
      // whichever account happens to sign in next on a shared browser.
      const request = indexedDB.open("personal-archive-writing", 2);
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("scope", "scope");
      };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
        resolve(request.result);
      };
      request.onerror = () => reject(new Error("Local writing storage unavailable"));
      request.onblocked = () => { blocked = true; reject(new Error("Close an older writing tab to upgrade local draft storage")); };
    }).catch((error) => { databasePromise = null; throw error; });
  }
  return databasePromise;
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Local writing storage request failed"));
  });
}
function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(new Error("Local writing storage transaction failed"));
  });
}
function matches(stored: StoredDraft | null | undefined, scope: DraftScope): stored is StoredDraft {
  return Boolean(stored?.draft && stored.scope === draftScopeKey(scope) && stored.key === keyFor(scope, stored.draft.manuscriptId, stored.draft.chapterId));
}
async function removePersistent(key: string): Promise<void> {
  let incomplete = false;
  try {
    if (typeof indexedDB !== "undefined") {
      const database = await openDatabase();
      const transaction = database.transaction(STORE, "readwrite");
      const finished = done(transaction);
      transaction.objectStore(STORE).delete(key);
      await finished;
    }
  } catch { incomplete = true; }
  try { localStorage.removeItem(localKey(key)); } catch { incomplete = true; }
  if (incomplete) throw new Error("Unable to confirm removal of an older device copy. Keep this tab open and retry when browser storage is available.");
}
export async function readManuscriptLocalDraft(manuscriptId: string, chapterId: string, scope: DraftScope): Promise<ManuscriptLocalDraft | null> {
  return (await listManuscriptLocalDrafts(manuscriptId, scope)).find((draft) => draft.chapterId === chapterId) ?? null;
}
export async function writeManuscriptLocalDraft(draft: ManuscriptLocalDraft, scope: DraftScope, persistPlaintext = false): Promise<boolean> {
  const key = keyFor(scope, draft.manuscriptId, draft.chapterId);
  const stored: StoredDraft = { key, scope: draftScopeKey(scope), draft: structuredClone(draft) };
  memory.set(key, stored); // Always retain a copy in this tab before attempting disk storage.
  if (!draft.encrypted && !persistPlaintext) {
    await removePersistent(key);
    return false;
  }
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readwrite");
    const finished = done(transaction);
    transaction.objectStore(STORE).put(stored);
    await finished;
    try { localStorage.removeItem(localKey(key)); } catch { /* IndexedDB has the copy. */ }
  } catch { localStorage.setItem(localKey(key), JSON.stringify(stored)); }
  return true;
}
export async function listManuscriptLocalDrafts(manuscriptId: string, scope: DraftScope): Promise<ManuscriptLocalDraft[]> {
  const scopeKey = draftScopeKey(scope);
  const drafts = new Map<string, ManuscriptLocalDraft>();
  const add = (stored: StoredDraft) => {
    if (!matches(stored, scope) || stored.draft.manuscriptId !== manuscriptId) return;
    const old = drafts.get(stored.draft.chapterId);
    if (!old || stored.draft.savedAt >= old.savedAt) drafts.set(stored.draft.chapterId, structuredClone(stored.draft));
  };
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readonly");
    const finished = done(transaction);
    const [rows] = await Promise.all([result(transaction.objectStore(STORE).index("scope").getAll(scopeKey) as IDBRequest<StoredDraft[]>), finished]);
    rows.forEach(add);
  } catch { /* Check only this account's fallback below. */ }
  try {
    const prefix = PREFIX + JSON.stringify([scopeKey]).slice(0, -1) + ",";
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try { add(JSON.parse(localStorage.getItem(key) || "null")); } catch { /* Malformed entries are not adopted. */ }
    }
  } catch { /* Return the copies still available in memory. */ }
  for (const stored of memory.values()) add(stored);
  return [...drafts.values()];
}
export async function deleteManuscriptLocalDraft(manuscriptId: string, chapterId: string, scope: DraftScope): Promise<void> {
  const key = keyFor(scope, manuscriptId, chapterId);
  await removePersistent(key);
  memory.delete(key);
}
