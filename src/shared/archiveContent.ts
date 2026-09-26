import { isEncryptedManuscriptBody } from "./manuscriptEncryption";

/** Conservative document candidates, including canonical editor URLs in HTML/Markdown.
 * Retaining an incidental UUID is safer than retiring an object still used by a draft.
 * Arbitrarily encoded or external URLs require a separate import/review workflow.
 */
export function archiveDocumentCandidates(body: string): string[] {
  if (isEncryptedManuscriptBody(body)) return [];
  return [...new Set((body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map((id) => id.toLowerCase()))];
}

export function archiveInlineDocumentIds(body: string): Set<string> {
  return new Set([...body.matchAll(/\/api\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)].map((match) => match[1].toLowerCase()));
}

export type ArchiveContentKind = "discussion" | "knowledge" | "manuscript";
