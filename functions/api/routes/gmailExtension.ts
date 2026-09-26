import type { Context, Hono } from "hono";
import { z } from "zod";
import { contactDisplayName } from "../../../src/shared/format";
import {
  COMMUNICATION_DIRECTIONS,
  GMAIL_EXTENSION_TOKEN_SCOPES,
  type GmailExtensionTokenScope,
  type PublicUser
} from "../../../src/shared/types";
import { requirePermission } from "../../../src/server/auth/permissions";
import { createSessionToken, hashSessionToken } from "../../../src/server/auth/session";
import type { AppEnv } from "../../../src/server/env";
import type { AppRepository } from "../../../src/server/repositories/types";

type ApiApp = Hono<{ Bindings: AppEnv; Variables: { repo: AppRepository; user: PublicUser } }>;
type ApiContext = Context<{ Bindings: AppEnv; Variables: { repo: AppRepository; user: PublicUser } }>;

const optionalUuidSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullable().optional()
);
const communicationDirectionSchema = z.enum(COMMUNICATION_DIRECTIONS);
const gmailExtensionScopeSchema = z.enum(GMAIL_EXTENSION_TOKEN_SCOPES);
const gmailExtensionTokenInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  scopes: z.array(gmailExtensionScopeSchema).min(1).optional()
});
const gmailEmailAddressSchema = z.object({
  name: z.string().trim().max(240).default(""),
  email: z.string().trim().max(320).default("")
});
const gmailArchiveEmailSchema = z
  .object({
    schemaVersion: z.literal(1),
    clientRequestId: z.string().trim().max(120).default(""),
    extension: z
      .object({
        name: z.string().trim().max(120).default("md3-gmail-extension"),
        version: z.string().trim().max(40).default("")
      })
      .default({ name: "md3-gmail-extension", version: "" }),
    gmail: z.object({
      capturedAt: z.string().trim().min(10),
      messageUrl: z
        .string()
        .trim()
        .url()
        .refine((value) => /^https:\/\/mail\.google\.com\//i.test(value), "Gmail message URL must start with https://mail.google.com/."),
      threadId: z.string().trim().max(500).default(""),
      messageId: z.string().trim().max(500).default(""),
      rfcMessageId: z.string().trim().max(500).default(""),
      subject: z.string().trim().min(1).max(500),
      from: z.array(gmailEmailAddressSchema).default([]),
      to: z.array(gmailEmailAddressSchema).default([]),
      cc: z.array(gmailEmailAddressSchema).default([]),
      date: z.string().trim().default(""),
      bodyText: z.string().trim().max(100_000).default(""),
      bodyHtml: z.string().max(250_000).default(""),
      snippet: z.string().trim().max(2_000).default(""),
      attachments: z.array(z.record(z.string(), z.unknown())).default([]),
      captureWarnings: z.array(z.string().trim().max(500)).default([])
    }),
    links: z
      .object({
        contactId: optionalUuidSchema,
        partyOrganizationId: optionalUuidSchema,
        caseId: optionalUuidSchema,
        assetId: optionalUuidSchema
      })
      .default({}),
    filing: z.object({
      direction: communicationDirectionSchema,
      status: z.enum(["New", "Logged", "Needs follow-up", "Linked"]),
      note: z.string().trim().max(10_000).default("")
    })
  })
  .refine((input) => Boolean(input.gmail.bodyText || input.gmail.snippet), {
    message: "Email body text or snippet is required.",
    path: ["gmail", "bodyText"]
  });

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function applyGmailExtensionCors(context: ApiContext) {
  const origin = context.req.header("origin") ?? "";
  if (origin.startsWith("chrome-extension://")) {
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Vary", "Origin");
  }
  context.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  context.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  context.header("Access-Control-Max-Age", "600");
}

function integrationError(
  context: ApiContext,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503,
  code: string,
  message: string,
  details: Record<string, unknown> = {}
) {
  applyGmailExtensionCors(context);
  return context.json({ ok: false, error: { code, message, details } }, status);
}

async function readGmailExtensionToken(context: ApiContext, requiredScope: GmailExtensionTokenScope) {
  const header = context.req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { response: integrationError(context, 401, "TOKEN_MISSING", "Missing extension API bearer token.") };
  const tokenHash = await hashSessionToken(match[1].trim());
  const token = await context.get("repo").getGmailExtensionTokenByHash(tokenHash);
  if (!token) return { response: integrationError(context, 401, "TOKEN_INVALID", "The extension API token is invalid or revoked.") };
  if (requiredScope !== "gmail:health" && !token.scopes.includes(requiredScope)) {
    return { response: integrationError(context, 403, "SCOPE_REQUIRED", `The token requires ${requiredScope}.`) };
  }
  const user = await context.get("repo").getUserById(token.ownerUserId);
  if (!user) return { response: integrationError(context, 401, "TOKEN_INVALID", "The extension API token owner no longer exists.") };
  await context.get("repo").markGmailExtensionTokenUsed(token.tokenId);
  return { token, user };
}

function compactSubtitle(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}

function matchedBy(q: string, candidates: Record<string, string | null | undefined>): string {
  const needle = q.trim().toLowerCase();
  const match = Object.entries(candidates).find(([, value]) => value?.toLowerCase().includes(needle));
  return match?.[0] ?? "text";
}

function emailAddressListText(values: Array<{ name?: string; email?: string }>): string {
  return values
    .map((item) => [item.name, item.email ? `<${item.email}>` : ""].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
}

function buildGmailCommunicationBody(input: z.infer<typeof gmailArchiveEmailSchema>): string {
  const headerLines = [
    `From: ${emailAddressListText(input.gmail.from) || "Unknown"}`,
    `To: ${emailAddressListText(input.gmail.to) || "Unknown"}`,
    input.gmail.cc.length ? `Cc: ${emailAddressListText(input.gmail.cc)}` : "",
    `Date: ${input.gmail.date || input.gmail.capturedAt}`,
    `Gmail URL: ${input.gmail.messageUrl}`
  ].filter(Boolean);
  const sections = [`Archived from Gmail\n${headerLines.join("\n")}`];
  if (input.filing.note) sections.push(`Filing note\n${input.filing.note}`);
  sections.push(`Email body\n${input.gmail.bodyText || input.gmail.snippet}`);
  return sections.join("\n\n");
}

function gmailDuplicateKeys(input: z.infer<typeof gmailArchiveEmailSchema>): string[] {
  return [
    input.gmail.rfcMessageId,
    input.gmail.messageId,
    input.gmail.threadId && input.gmail.subject && input.gmail.date
      ? `${input.gmail.threadId}|${input.gmail.subject}|${input.gmail.date}`
      : "",
    input.gmail.messageUrl,
    input.clientRequestId
  ].filter(Boolean);
}

export function registerGmailExtensionPublicRoutes(app: ApiApp) {
  app.options("/integrations/gmail-extension/*", (context) => {
    applyGmailExtensionCors(context);
    return context.body(null, 204);
  });

  app.get("/integrations/gmail-extension/health", async (context) => {
    applyGmailExtensionCors(context);
    const auth = await readGmailExtensionToken(context, "gmail:health");
    if ("response" in auth) return auth.response;
    return context.json({
      ok: true,
      workspaceName: "MD3 Platform",
      serverTime: new Date().toISOString(),
      capabilities: {
        search: auth.token.scopes.includes("gmail:search"),
        archiveEmail: auth.token.scopes.includes("gmail:archive"),
        attachments: false
      },
      user: {
        userId: auth.user.userId,
        name: auth.user.name,
        role: auth.user.role
      }
    });
  });

  app.get("/integrations/gmail-extension/search", async (context) => {
    applyGmailExtensionCors(context);
    const auth = await readGmailExtensionToken(context, "gmail:search");
    if ("response" in auth) return auth.response;
    try {
      requirePermission(auth.user, "view", "case");
    } catch {
      return integrationError(context, 403, "SCOPE_REQUIRED", "The token owner cannot search MD3 records.");
    }
    const q = (context.req.query("q") ?? "").trim();
    const limit = Math.min(positiveInteger(context.req.query("limit"), 8), 20);
    if (q.length < 2) {
      return context.json({ contacts: [], organizations: [], services: [], assets: [] });
    }
    const repo = context.get("repo");
    const [contacts, organizations, services, assets] = await Promise.all([
      repo.listContacts(q),
      repo.listPartyOrganizations(q),
      repo.listCases({ q, archiveStatus: "active" }),
      repo.listAssets({ q })
    ]);
    return context.json({
      contacts: contacts.slice(0, limit).map((contact) => ({
        id: contact.contactId,
        label: contactDisplayName(contact),
        subtitle: compactSubtitle([contact.phone, contact.email, contact.partyOrganizationName]),
        matchedBy: matchedBy(q, {
          name: contactDisplayName(contact),
          email: contact.email,
          phone: contact.phone,
          organization: contact.partyOrganizationName
        })
      })),
      organizations: organizations.slice(0, limit).map((organization) => ({
        id: organization.partyOrganizationId,
        label: organization.name,
        subtitle: compactSubtitle([organization.phone, organization.email, organization.website]),
        matchedBy: matchedBy(q, {
          name: organization.name,
          email: organization.email,
          phone: organization.phone,
          website: organization.website
        })
      })),
      services: services.slice(0, limit).map((service) => ({
        id: service.caseId,
        label: service.caseNumber,
        subtitle: compactSubtitle([service.propertyAddress, service.customerOrganizationName, service.status]),
        matchedBy: matchedBy(q, {
          serviceNumber: service.caseNumber,
          title: service.propertyAddress,
          organization: service.customerOrganizationName,
          notes: service.notes
        })
      })),
      assets: assets.slice(0, limit).map((asset) => ({
        id: asset.assetId,
        label: asset.name,
        subtitle: compactSubtitle([asset.assetType, asset.partyOrganizationName, asset.caseNumber]),
        matchedBy: matchedBy(q, {
          name: asset.name,
          type: asset.assetType,
          organization: asset.partyOrganizationName,
          serviceNumber: asset.caseNumber,
          serial: asset.serialNumber,
          ip: asset.lanIp || asset.wanIp,
          phone: asset.phoneNumber
        })
      }))
    });
  });

  app.post("/integrations/gmail-extension/archive-email", async (context) => {
    applyGmailExtensionCors(context);
    const auth = await readGmailExtensionToken(context, "gmail:archive");
    if ("response" in auth) return auth.response;
    try {
      requirePermission(auth.user, "create", "note");
    } catch {
      return integrationError(context, 403, "SCOPE_REQUIRED", "The token owner cannot archive communications.");
    }
    const parsed = gmailArchiveEmailSchema.safeParse(await context.req.json().catch(() => ({})));
    if (!parsed.success) {
      return integrationError(context, 400, "VALIDATION_FAILED", "The archive email payload is invalid.", {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      });
    }
    const input = parsed.data;
    const repo = context.get("repo");
    const links = {
      contactId: input.links.contactId ?? null,
      partyOrganizationId: input.links.partyOrganizationId ?? null,
      caseId: input.links.caseId ?? null,
      assetId: input.links.assetId ?? null
    };

    if (links.caseId && !(await repo.getCase(links.caseId))) {
      return integrationError(context, 404, "RECORD_NOT_FOUND", "Linked service was not found or is archived.", { caseId: links.caseId });
    }
    if (links.contactId && !(await repo.getContact(links.contactId))) {
      return integrationError(context, 404, "RECORD_NOT_FOUND", "Linked contact was not found.", { contactId: links.contactId });
    }
    if (links.partyOrganizationId && !(await repo.getPartyOrganization(links.partyOrganizationId))) {
      return integrationError(context, 404, "RECORD_NOT_FOUND", "Linked organization was not found.", {
        partyOrganizationId: links.partyOrganizationId
      });
    }
    if (links.assetId && !(await repo.getAsset(links.assetId))) {
      return integrationError(context, 404, "RECORD_NOT_FOUND", "Linked asset was not found.", { assetId: links.assetId });
    }

    const duplicateKeys = gmailDuplicateKeys(input);
    const duplicate =
      (await repo.findCommunicationByExternalReferences("Gmail", duplicateKeys, "Gmail")) ??
      (await repo.findCommunicationByExternalReferences("Gmail", duplicateKeys));
    if (duplicate) {
      return context.json({
        ok: true,
        communicationId: duplicate.communicationId,
        status: duplicate.status,
        duplicate: true,
        linked: {
          contactId: duplicate.contactId ?? null,
          partyOrganizationId: duplicate.partyOrganizationId ?? null,
          caseId: duplicate.caseId ?? null,
          assetId: duplicate.assetId ?? null
        }
      });
    }

    const externalReference =
      input.gmail.rfcMessageId || input.gmail.messageId || input.gmail.threadId || input.gmail.messageUrl || input.clientRequestId;
    const communication = await repo.createCommunication({
      caseId: links.caseId,
      partyOrganizationId: links.partyOrganizationId,
      contactId: links.contactId,
      assetId: links.assetId,
      supportingDocumentId: null,
      communicationType: "Email",
      direction: input.filing.direction,
      source: "Gmail",
      status: input.filing.status,
      externalProvider: "Gmail",
      externalReference,
      externalUrl: input.gmail.messageUrl,
      sourceMetadata: {
        integration: "md3-gmail-extension",
        schemaVersion: input.schemaVersion,
        clientRequestId: input.clientRequestId,
        extension: input.extension,
        gmailThreadId: input.gmail.threadId,
        gmailMessageId: input.gmail.messageId,
        rfcMessageId: input.gmail.rfcMessageId,
        messageUrl: input.gmail.messageUrl,
        subject: input.gmail.subject,
        date: input.gmail.date,
        capturedAt: input.gmail.capturedAt,
        from: input.gmail.from,
        to: input.gmail.to,
        cc: input.gmail.cc,
        snippet: input.gmail.snippet,
        bodyHtmlAvailable: Boolean(input.gmail.bodyHtml),
        attachments: input.gmail.attachments,
        captureWarnings: input.gmail.captureWarnings
      },
      subject: input.gmail.subject,
      body: buildGmailCommunicationBody(input),
      occurredAt: input.gmail.date || input.gmail.capturedAt,
      createdBy: auth.user.userId
    });
    await repo.createAuditLog({
      action: "gmail_extension.email_archived",
      entityType: "communication",
      entityId: communication.communicationId,
      user: auth.user,
      metadata: {
        tokenId: auth.token.tokenId,
        tokenOwnerUserId: auth.token.ownerUserId,
        communicationId: communication.communicationId,
        linked: links,
        externalReference,
        externalUrl: input.gmail.messageUrl,
        clientRequestId: input.clientRequestId,
        userAgent: context.req.header("user-agent") ?? "",
        sourceIp: context.req.header("cf-connecting-ip") ?? context.req.header("x-forwarded-for") ?? ""
      }
    });
    return context.json(
      {
        ok: true,
        communicationId: communication.communicationId,
        status: communication.status,
        duplicate: false,
        linked: links
      },
      201
    );
  });
}

export function registerGmailExtensionTokenRoutes(app: ApiApp) {
  app.get("/integrations/gmail-extension/tokens", async (context) => {
    const user = context.get("user");
    requirePermission(user, "view", "settings");
    if (user.role !== "Admin") return context.json({ error: "Admin role required" }, 403);
    return context.json(await context.get("repo").listGmailExtensionTokens());
  });

  app.post("/integrations/gmail-extension/tokens", async (context) => {
    const user = context.get("user");
    requirePermission(user, "settings", "settings");
    if (user.role !== "Admin") return context.json({ error: "Admin role required" }, 403);
    const input = gmailExtensionTokenInputSchema.parse(await context.req.json());
    const scopes = input.scopes ?? [...GMAIL_EXTENSION_TOKEN_SCOPES];
    const rawToken = `md3_gmail_${createSessionToken()}`;
    const tokenRecord = await context.get("repo").createGmailExtensionToken({
      name: input.name,
      tokenHash: await hashSessionToken(rawToken),
      scopes,
      ownerUserId: user.userId,
      createdBy: user.userId
    });
    await context.get("repo").createAuditLog({
      action: "gmail_extension.token_created",
      entityType: "gmail_extension_token",
      entityId: tokenRecord.tokenId,
      user,
      metadata: {
        tokenId: tokenRecord.tokenId,
        name: tokenRecord.name,
        scopes: tokenRecord.scopes,
        ownerUserId: tokenRecord.ownerUserId
      }
    });
    return context.json({ token: rawToken, tokenRecord }, 201);
  });

  app.delete("/integrations/gmail-extension/tokens/:id", async (context) => {
    const user = context.get("user");
    requirePermission(user, "settings", "settings");
    if (user.role !== "Admin") return context.json({ error: "Admin role required" }, 403);
    const tokenRecord = await context.get("repo").revokeGmailExtensionToken(context.req.param("id"));
    if (!tokenRecord) return context.json({ error: "Token not found" }, 404);
    await context.get("repo").createAuditLog({
      action: "gmail_extension.token_revoked",
      entityType: "gmail_extension_token",
      entityId: tokenRecord.tokenId,
      user,
      metadata: {
        tokenId: tokenRecord.tokenId,
        name: tokenRecord.name,
        scopes: tokenRecord.scopes,
        ownerUserId: tokenRecord.ownerUserId
      }
    });
    return context.json(tokenRecord);
  });
}
