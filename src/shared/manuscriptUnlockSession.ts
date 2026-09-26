import type { ManuscriptWorkKey } from "./manuscriptEncryption";

const DEFAULT_HANDOFF_TTL_MS = 5 * 60 * 1000;

type StagedManuscriptKey = {
  key: ManuscriptWorkKey;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

const stagedKeys = new Map<string, StagedManuscriptKey>();

export function clearStagedManuscriptKey(manuscriptId: string) {
  const staged = stagedKeys.get(manuscriptId);
  if (!staged) return;
  clearTimeout(staged.timer);
  staged.key.fill(0);
  stagedKeys.delete(manuscriptId);
}

export function stageManuscriptUnlockKey(
  manuscriptId: string,
  key: ManuscriptWorkKey,
  ttlMs = DEFAULT_HANDOFF_TTL_MS
) {
  clearStagedManuscriptKey(manuscriptId);
  const expiresAt = Date.now() + ttlMs;
  const timer = setTimeout(() => clearStagedManuscriptKey(manuscriptId), ttlMs);
  stagedKeys.set(manuscriptId, { key, expiresAt, timer });
}

export function takeStagedManuscriptKey(manuscriptId: string): ManuscriptWorkKey | null {
  const staged = stagedKeys.get(manuscriptId);
  if (!staged) return null;
  clearTimeout(staged.timer);
  stagedKeys.delete(manuscriptId);
  if (staged.expiresAt <= Date.now()) {
    staged.key.fill(0);
    return null;
  }
  return staged.key;
}
