import { z } from "zod";

// References to a reviewed maintenance record, never passwords or key material.
const reference = z.string().min(3).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]+$/);
export const manuscriptKeyOwnerClaimSchema = z.object({
  manuscriptId: z.uuid(),
  ownerUserId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  evidenceReference: reference,
  operatorReference: reference
}).strict();
export type ManuscriptKeyOwnerClaimInput = z.infer<typeof manuscriptKeyOwnerClaimSchema>;
export interface ManuscriptKeyOwnershipReview {
  manuscriptId: string;
  createdBy: string | null;
  expectedUpdatedAt: string;
  encryptionEnabled: boolean;
  deleted: boolean;
}
