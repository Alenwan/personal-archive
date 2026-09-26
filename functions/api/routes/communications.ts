import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  COMMUNICATION_CHANNELS,
  type BulkActionResult,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_SOURCES,
  COMMUNICATION_STATUSES,
  COMMUNICATION_TYPES,
  type CommunicationRecord,
  type PublicUser
} from "../../../src/shared/types";
import { requirePermission } from "../../../src/server/auth/permissions";
import type { AppEnv } from "../../../src/server/env";
import type { AppRepository } from "../../../src/server/repositories/types";

type ApiApp = Hono<{ Bindings: AppEnv; Variables: { repo: AppRepository; user: PublicUser } }>;

const optionalUuidSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullable().optional()
);
const communicationInputSchema = z.object({
  caseId: optionalUuidSchema,
  partyOrganizationId: optionalUuidSchema,
  contactId: optionalUuidSchema,
  assetId: optionalUuidSchema,
  supportingDocumentId: optionalUuidSchema,
  communicationType: z.enum(COMMUNICATION_TYPES),
  direction: z.enum(COMMUNICATION_DIRECTIONS),
  source: z.enum(COMMUNICATION_SOURCES).optional().default("Manual"),
  status: z.enum(COMMUNICATION_STATUSES).optional(),
  followUpAssignedTo: optionalUuidSchema,
  followUpDueDate: z
    .preprocess((value) => (value === "" ? null : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  externalProvider: z.string().trim().default(""),
  externalReference: z.string().trim().default(""),
  externalUrl: z
    .string()
    .trim()
    .default("")
    .refine((value) => !value || /^https?:\/\//i.test(value), "External link must start with http:// or https://."),
  sourceMetadata: z.record(z.string(), z.unknown()).optional().default({}),
  subject: z.string().trim().min(2),
  body: z.string().trim().default(""),
  occurredAt: z.string().trim().min(10)
});
const communicationBulkActionSchema = z.object({
  action: z.enum(["set-status", "assign-follow-up", "clear-follow-up", "link-service"]),
  communicationIds: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(COMMUNICATION_STATUSES).optional(),
  followUpAssignedTo: optionalUuidSchema,
  followUpDueDate: z
    .preprocess((value) => (value === "" ? null : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  caseId: optionalUuidSchema
});

function enumQuery<T extends readonly string[]>(value: string | undefined, values: T): T[number] | undefined {
  return value && (values as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function paginationFromQuery(query: Record<string, string | undefined>) {
  return {
    page: Math.max(1, positiveInteger(query.page, 1)),
    pageSize: Math.min(100, Math.max(10, positiveInteger(query.pageSize, 25)))
  };
}

async function requireActiveCase(repo: AppRepository, caseId: string) {
  const record = await repo.getCase(caseId);
  if (!record) {
    throw new HTTPException(404, {
      message: "Case not found or archived. Restore the case before making changes."
    });
  }
  return record;
}

async function validateCommunicationLinks(
  repo: AppRepository,
  input: Partial<z.infer<typeof communicationInputSchema>>,
  linkedCaseId: string | null
): Promise<{ error: string } | null> {
  if (linkedCaseId) await requireActiveCase(repo, linkedCaseId);
  if (input.partyOrganizationId && !(await repo.getPartyOrganization(input.partyOrganizationId))) {
    return { error: "Organization not found" };
  }
  if (input.contactId && !(await repo.getContact(input.contactId))) {
    return { error: "Contact not found" };
  }
  if (input.assetId && !(await repo.getAsset(input.assetId))) {
    return { error: "Asset not found" };
  }
  if (input.supportingDocumentId) {
    const document = await repo.getDocument(input.supportingDocumentId);
    if (!document || (linkedCaseId && document.caseId !== linkedCaseId)) {
      return { error: "Supporting document not found" };
    }
  }
  if (input.followUpAssignedTo && !(await repo.getUserById(input.followUpAssignedTo))) {
    return { error: "Follow-up owner not found" };
  }
  return null;
}

function communicationAuditMetadata(communication: CommunicationRecord) {
  return {
    caseId: communication.caseId ?? null,
    communicationType: communication.communicationType,
    direction: communication.direction,
    source: communication.source,
    status: communication.status,
    followUpAssignedTo: communication.followUpAssignedTo ?? null,
    followUpAssignedToName: communication.followUpAssignedToName ?? null,
    followUpDueDate: communication.followUpDueDate ?? null,
    externalProvider: communication.externalProvider,
    externalReference: communication.externalReference,
    externalUrl: communication.externalUrl,
    subject: communication.subject,
    partyOrganizationId: communication.partyOrganizationId ?? null,
    contactId: communication.contactId ?? null,
    assetId: communication.assetId ?? null,
    supportingDocumentId: communication.supportingDocumentId ?? null
  };
}

export function registerCommunicationRoutes(app: ApiApp): void {
  app.get("/communications", async (context) => {
    const user = context.get("user");
    requirePermission(user, "view", "case");
    requirePermission(user, "view", "note");
    return context.json(
      await context.get("repo").listAllCommunications({
        q: context.req.query("q"),
        status: enumQuery(context.req.query("status"), COMMUNICATION_STATUSES),
        channel: enumQuery(context.req.query("channel"), COMMUNICATION_CHANNELS),
        communicationType: enumQuery(context.req.query("communicationType"), COMMUNICATION_TYPES),
        direction: enumQuery(context.req.query("direction"), COMMUNICATION_DIRECTIONS),
        source: enumQuery(context.req.query("source"), COMMUNICATION_SOURCES),
        followUpAssignedTo: context.req.query("followUpAssignedTo"),
        followUpDueFrom: context.req.query("followUpDueFrom"),
        followUpDueTo: context.req.query("followUpDueTo"),
        caseId: context.req.query("caseId"),
        partyOrganizationId: context.req.query("partyOrganizationId"),
        contactId: context.req.query("contactId"),
        assetId: context.req.query("assetId"),
        dateFrom: context.req.query("dateFrom"),
        dateTo: context.req.query("dateTo"),
        unlinked: context.req.query("unlinked") === "true" ? "true" : undefined,
        workflowView: context.req.query("workflowView") as never,
        sort: context.req.query("sort") as never,
        sortDirection: context.req.query("sortDirection") === "asc" ? "asc" : "desc"
      })
    );
  });

  app.get("/communications/page", async (context) => {
    const user = context.get("user");
    requirePermission(user, "view", "case");
    requirePermission(user, "view", "note");
    const query = context.req.query();
    return context.json(
      await context.get("repo").listAllCommunicationsPage(
        {
          q: query.q,
          status: enumQuery(query.status, COMMUNICATION_STATUSES),
          channel: enumQuery(query.channel, COMMUNICATION_CHANNELS),
          communicationType: enumQuery(query.communicationType, COMMUNICATION_TYPES),
          direction: enumQuery(query.direction, COMMUNICATION_DIRECTIONS),
          source: enumQuery(query.source, COMMUNICATION_SOURCES),
          followUpAssignedTo: query.followUpAssignedTo,
          followUpDueFrom: query.followUpDueFrom,
          followUpDueTo: query.followUpDueTo,
          caseId: query.caseId,
          partyOrganizationId: query.partyOrganizationId,
          contactId: query.contactId,
          assetId: query.assetId,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          unlinked: query.unlinked === "true" ? "true" : undefined,
          workflowView: query.workflowView as never,
          sort: query.sort as never,
          sortDirection: query.sortDirection === "asc" ? "asc" : "desc"
        },
        paginationFromQuery(query)
      )
    );
  });

  app.post("/communications", async (context) => {
    const user = context.get("user");
    requirePermission(user, "create", "note");
    const repo = context.get("repo");
    const input = communicationInputSchema.parse(await context.req.json());
    const linkedCaseId = input.caseId ?? null;
    const linkError = await validateCommunicationLinks(repo, input, linkedCaseId);
    if (linkError) return context.json(linkError, 400);

    const communication = await repo.createCommunication({
      caseId: linkedCaseId,
      partyOrganizationId: input.partyOrganizationId ?? null,
      contactId: input.contactId ?? null,
      assetId: input.assetId ?? null,
      supportingDocumentId: input.supportingDocumentId ?? null,
      communicationType: input.communicationType,
      direction: input.direction,
      source: input.source,
      status: input.status ?? (linkedCaseId ? "Linked" : "New"),
      followUpAssignedTo: input.followUpAssignedTo ?? null,
      followUpDueDate: input.followUpDueDate ?? null,
      externalProvider: input.externalProvider,
      externalReference: input.externalReference,
      externalUrl: input.externalUrl,
      sourceMetadata: input.sourceMetadata,
      subject: input.subject,
      body: input.body,
      occurredAt: input.occurredAt,
      createdBy: user.userId
    });
    await repo.createAuditLog({
      action: "communication.created",
      entityType: "communication",
      entityId: communication.communicationId,
      user,
      metadata: communicationAuditMetadata(communication)
    });
    return context.json(communication, 201);
  });

  app.post("/communications/bulk", async (context) => {
    const user = context.get("user");
    requirePermission(user, "create", "note");
    const repo = context.get("repo");
    const input = communicationBulkActionSchema.parse(await context.req.json());
    if (input.action === "set-status" && !input.status) return context.json({ error: "Status is required" }, 400);
    if (input.action === "assign-follow-up" && input.followUpAssignedTo && !(await repo.getUserById(input.followUpAssignedTo))) {
      return context.json({ error: "Follow-up owner not found" }, 400);
    }
    if (input.action === "link-service" && input.caseId) await requireActiveCase(repo, input.caseId);
    const result: BulkActionResult = { requested: input.communicationIds.length, succeeded: 0, failed: [] };
    for (const communicationId of input.communicationIds) {
      try {
        const existing = await repo.getCommunication(communicationId);
        if (!existing) throw new Error("Communication not found");
        if (input.action === "set-status") {
          await repo.updateCommunication(communicationId, { status: input.status });
        } else if (input.action === "assign-follow-up") {
          await repo.updateCommunication(communicationId, {
            status: "Needs follow-up",
            followUpAssignedTo: input.followUpAssignedTo ?? null,
            followUpDueDate: input.followUpDueDate ?? null
          });
        } else if (input.action === "clear-follow-up") {
          await repo.updateCommunication(communicationId, {
            status: existing.caseId ? "Linked" : "Logged",
            followUpAssignedTo: null,
            followUpDueDate: null
          });
        } else {
          await repo.updateCommunication(communicationId, {
            caseId: input.caseId ?? null,
            status: input.caseId ? "Linked" : existing.status === "Linked" ? "Logged" : existing.status
          });
        }
        result.succeeded += 1;
      } catch (error) {
        result.failed.push({
          id: communicationId,
          error: error instanceof Error ? error.message : "Bulk communication action failed"
        });
      }
    }
    await repo.createAuditLog({
      action: "communication.bulk_action",
      entityType: "communication",
      entityId: input.communicationIds[0] ?? "bulk",
      user,
      metadata: { action: input.action, requested: result.requested, succeeded: result.succeeded, failed: result.failed.length }
    });
    return context.json(result);
  });

  app.patch("/communications/:id", async (context) => {
    const user = context.get("user");
    requirePermission(user, "create", "note");
    const repo = context.get("repo");
    const communicationId = context.req.param("id");
    const existing = await repo.getCommunication(communicationId);
    if (!existing) return context.json({ error: "Communication not found" }, 404);
    const input = communicationInputSchema.partial().parse(await context.req.json());
    const linkedCaseId = input.caseId === undefined ? existing.caseId ?? null : input.caseId ?? null;
    const linkError = await validateCommunicationLinks(repo, input, linkedCaseId);
    if (linkError) return context.json(linkError, 400);

    const communication = await repo.updateCommunication(communicationId, {
      ...input,
      caseId: linkedCaseId
    });
    if (!communication) return context.json({ error: "Communication not found" }, 404);
    await repo.createAuditLog({
      action: "communication.updated",
      entityType: "communication",
      entityId: communication.communicationId,
      user,
      metadata: communicationAuditMetadata(communication)
    });
    return context.json(communication);
  });
}
