import { z } from "zod";

export const bookmarkAnchorSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().min(1),
  format: z.enum(["rich-text", "markdown"]),
  block: z.number().int().min(0).max(1000000),
  offset: z.number().int().min(0).max(20000000),
  kind: z.enum(["text", "image"]),
  exact: z.string().max(96).default(""),
  prefix: z.string().max(48).default(""),
  suffix: z.string().max(48).default("")
}).strict();
export const bookmarkInputSchema = z.object({
  chapterId: z.uuid(),
  name: z.string().trim().max(120).default(""),
  anchor: bookmarkAnchorSchema
}).strict();
export type BookmarkAnchor = z.infer<typeof bookmarkAnchorSchema>;
export type ManuscriptBookmarkInput = z.infer<typeof bookmarkInputSchema>;
export interface ManuscriptBookmark extends ManuscriptBookmarkInput {
  bookmarkId: string;
  manuscriptId: string;
  userId: string;
  positionOnly: boolean;
  createdAt: string;
  updatedAt: string;
}
export class BookmarkConflictError extends Error {}
export function bookmarkForStorage(input: ManuscriptBookmarkInput, revision: number, format: string, encrypted: boolean) {
  const value = bookmarkInputSchema.parse(input);
  if (value.anchor.revision !== revision || value.anchor.format !== format) {
    throw new BookmarkConflictError("The chapter changed. Reopen it before adding a bookmark.");
  }
  return encrypted ? { ...value, name: "", anchor: positionOnlyAnchor(value.anchor) } : value;
}
export function positionOnlyAnchor(anchor: BookmarkAnchor): BookmarkAnchor {
  return { ...anchor, exact: "", prefix: "", suffix: "" };
}
