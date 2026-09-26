import { HTTPException } from "hono/http-exception";
import type { Manuscript, PublicUser } from "../../shared/types";

// Shared note editing does not grant access to a server-held recovery envelope.
// No fallback to Admin for legacy records without a resolvable owner: those
// require a separate, deliberate ownership recovery procedure.
export function requireManuscriptKeyOwner(user: PublicUser, manuscript: Manuscript | null, personalArchive = true): void {
  if (!manuscript) throw new HTTPException(404, { message: "Manuscript not found." });
  const owner = personalArchive ? manuscript.keyOwnerUserId : manuscript.createdBy;
  if (!owner || owner !== user.userId) {
    throw new HTTPException(403, { message: "Only the confirmed key owner can manage encryption or recover its password. An unresolved work requires a maintenance ownership review; its existing password still unlocks it." });
  }
}
