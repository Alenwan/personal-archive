import type { Context, Hono } from "hono";
import { z } from "zod";
import type { PublicUser } from "../../../src/shared/types";
import { requirePermission } from "../../../src/server/auth/permissions";
import type { AppEnv } from "../../../src/server/env";
import type { AppRepository } from "../../../src/server/repositories/types";
import {
  createForgejoBranch,
  createForgejoRepository,
  createForgejoRepositorySnapshot,
  createForgejoTag,
  deleteForgejoBranch,
  deleteForgejoRepository,
  deleteForgejoTag,
  ForgejoConfigurationError,
  ForgejoRequestError,
  importForgejoRepository,
  readForgejoOverview,
  readForgejoRepository,
  readForgejoRepositoryDetail,
  readForgejoSnapshotObject,
  updateForgejoRepository
} from "../../../src/server/services/forgejo";
import { createBackupStorage } from "../../../src/server/storage/documentStorage";

type ApiApp = Hono<{ Bindings: AppEnv; Variables: { repo: AppRepository; user: PublicUser } }>;
type ApiContext = Context<{ Bindings: AppEnv; Variables: { repo: AppRepository; user: PublicUser } }>;

const repositoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, dashes, or underscores.");
const gitRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use a valid Git branch or tag name.")
  .refine((value) => !value.includes("..") && !value.includes("//") && !value.endsWith(".") && !value.endsWith("/"), {
    message: "Use a valid Git branch or tag name."
  });
const createRepositorySchema = z.object({
  name: repositoryNameSchema,
  description: z.string().trim().max(500).default(""),
  isPrivate: z.boolean().default(true),
  initialize: z.boolean().default(false)
});
const importRepositorySchema = z
  .object({
    sourceUrl: z
      .string()
      .trim()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:" && (url.hostname === "github.com" || url.hostname === "www.github.com");
      }, "Use an HTTPS github.com repository URL."),
    name: repositoryNameSchema,
    description: z.string().trim().max(500).default(""),
    isPrivate: z.boolean().default(true),
    mirror: z.boolean().default(false),
    includeMetadata: z.boolean().default(false),
    sourceToken: z.string().trim().max(512).default("")
  })
  .refine((input) => !(input.mirror && input.sourceToken), {
    message: "Authenticated repositories can be imported once, but their token is not retained for mirror synchronization.",
    path: ["mirror"]
  });
const updateRepositorySchema = z
  .object({
    name: repositoryNameSchema.optional(),
    description: z.string().trim().max(500).optional(),
    defaultBranch: gitRefSchema.optional(),
    isPrivate: z.boolean().optional(),
    isArchived: z.boolean().optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), "At least one change is required.");
const createBranchSchema = z.object({ name: gitRefSchema, sourceRef: gitRefSchema.optional() });
const createTagSchema = z.object({
  name: gitRefSchema,
  target: gitRefSchema.optional(),
  message: z.string().trim().max(500).default("")
});
const deleteRepositorySchema = z.object({ confirmation: repositoryNameSchema });
const snapshotIdSchema = z.string().trim().regex(/^[A-Za-z0-9-]{16,80}$/);

function forgejoErrorResponse(context: ApiContext, error: unknown) {
  const message = error instanceof Error ? error.message : "The code repository service is unavailable.";
  if (error instanceof ForgejoConfigurationError) return context.json({ error: message }, 503);
  if (error instanceof ForgejoRequestError) {
    if (error.status === 403) return context.json({ error: message }, 403);
    if (error.status === 404) return context.json({ error: message }, 404);
    if (error.status === 409) return context.json({ error: message }, 409);
    if (error.status === 413) return context.json({ error: message }, 413);
    if (error.status === 422) return context.json({ error: message }, 422);
    if (error.status === 423) return context.json({ error: message }, 423);
    if (error.status === 504) return context.json({ error: message }, 504);
  }
  return context.json({ error: message }, 502);
}

function assertConfiguredOwner(env: AppEnv, owner: string): void {
  const configuredOwner = env.FORGEJO_OWNER?.trim();
  if (!configuredOwner || owner !== configuredOwner) {
    throw new ForgejoRequestError("This repository owner is not managed by Personal Archive.", 403);
  }
}

function repositoryParams(context: ApiContext): { owner: string; name: string } {
  const owner = z.string().trim().min(1).parse(context.req.param("owner"));
  const name = repositoryNameSchema.parse(context.req.param("name"));
  assertConfiguredOwner(context.env, owner);
  return { owner, name };
}

function repositoryAuditEntityId(repositoryId: number): string {
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) return crypto.randomUUID();
  const suffix = repositoryId.toString(16).padStart(12, "0").slice(-12);
  return `f047e100-0000-4000-8000-${suffix}`;
}

export function registerCodeRepositoryRoutes(app: ApiApp) {
  app.get("/code-repositories", async (context) => {
    requirePermission(context.get("user"), "view", "settings");
    try {
      return context.json(await readForgejoOverview(context.env));
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.post("/code-repositories", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    const input = createRepositorySchema.parse(await context.req.json());
    try {
      const repository = await createForgejoRepository(context.env, input);
      await context.get("repo").createAuditLog({
        action: "code_repository.created",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(repository.id),
        user,
        metadata: { fullName: repository.fullName, isPrivate: repository.isPrivate, initialized: input.initialize }
      });
      return context.json(repository, 201);
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.post("/code-repositories/import", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    const input = importRepositorySchema.parse(await context.req.json());
    try {
      const repository = await importForgejoRepository(context.env, input);
      await context.get("repo").createAuditLog({
        action: "code_repository.imported",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(repository.id),
        user,
        metadata: {
          fullName: repository.fullName,
          sourceHost: new URL(input.sourceUrl).hostname,
          isPrivate: repository.isPrivate,
          mirror: repository.isMirror,
          includedMetadata: input.includeMetadata,
          usedSourceToken: Boolean(input.sourceToken)
        }
      });
      return context.json(repository, 201);
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.get("/code-repositories/:owner/:name/detail", async (context) => {
    requirePermission(context.get("user"), "view", "settings");
    try {
      const { owner, name } = repositoryParams(context);
      return context.json(await readForgejoRepositoryDetail(context.env, createBackupStorage(context.env), owner, name));
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.post("/code-repositories/:owner/:name/branches", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    const input = createBranchSchema.parse(await context.req.json());
    try {
      const { owner, name } = repositoryParams(context);
      const repository = await readForgejoRepository(context.env, owner, name);
      const branch = await createForgejoBranch(context.env, owner, name, input);
      await context.get("repo").createAuditLog({
        action: "code_repository.branch_created",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(repository.id),
        user,
        metadata: { fullName: `${owner}/${name}`, branch: branch.name, sourceRef: input.sourceRef ?? null }
      });
      return context.json(branch, 201);
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.delete("/code-repositories/:owner/:name/branches/:branch", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    const branch = gitRefSchema.parse(context.req.param("branch"));
    try {
      const { owner, name } = repositoryParams(context);
      const detail = await readForgejoRepositoryDetail(context.env, createBackupStorage(context.env), owner, name);
      if (branch === detail.repository.defaultBranch) {
        return context.json({ error: "Change the default branch before deleting it." }, 409);
      }
      await deleteForgejoBranch(context.env, owner, name, branch);
      await context.get("repo").createAuditLog({
        action: "code_repository.branch_deleted",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(detail.repository.id),
        user,
        metadata: { fullName: detail.repository.fullName, branch }
      });
      return context.json({ ok: true });
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.post("/code-repositories/:owner/:name/tags", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    const input = createTagSchema.parse(await context.req.json());
    try {
      const { owner, name } = repositoryParams(context);
      const repository = await readForgejoRepository(context.env, owner, name);
      const tag = await createForgejoTag(context.env, owner, name, input);
      await context.get("repo").createAuditLog({
        action: "code_repository.tag_created",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(repository.id),
        user,
        metadata: { fullName: `${owner}/${name}`, tag: tag.name, target: input.target ?? null }
      });
      return context.json(tag, 201);
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.delete("/code-repositories/:owner/:name/tags/:tag", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    const tag = gitRefSchema.parse(context.req.param("tag"));
    try {
      const { owner, name } = repositoryParams(context);
      const repository = await readForgejoRepository(context.env, owner, name);
      await deleteForgejoTag(context.env, owner, name, tag);
      await context.get("repo").createAuditLog({
        action: "code_repository.tag_deleted",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(repository.id),
        user,
        metadata: { fullName: `${owner}/${name}`, tag }
      });
      return context.json({ ok: true });
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.post("/code-repositories/:owner/:name/snapshots", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    try {
      const { owner, name } = repositoryParams(context);
      const snapshot = await createForgejoRepositorySnapshot(context.env, createBackupStorage(context.env), owner, name);
      await context.get("repo").createAuditLog({
        action: "code_repository.snapshot_created",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(snapshot.repositoryId),
        user,
        metadata: {
          fullName: snapshot.fullName,
          snapshotId: snapshot.snapshotId,
          ref: snapshot.ref,
          archiveBytes: snapshot.archiveBytes
        }
      });
      return context.json(snapshot, 201);
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.get("/code-repositories/:owner/:name/snapshots/:snapshotId/download", async (context) => {
    requirePermission(context.get("user"), "view", "settings");
    try {
      const { owner, name } = repositoryParams(context);
      const snapshotId = snapshotIdSchema.parse(context.req.param("snapshotId"));
      const detail = await readForgejoRepositoryDetail(context.env, createBackupStorage(context.env), owner, name);
      const result = await readForgejoSnapshotObject(createBackupStorage(context.env), detail.repository.id, snapshotId);
      if (!result) return context.json({ error: "Repository snapshot not found." }, 404);
      const fileName = `${detail.repository.name}-${result.snapshot.ref.replace(/[^A-Za-z0-9._-]/g, "-")}-${snapshotId}.zip`;
      return new Response(result.object.body, {
        headers: {
          "content-type": result.object.contentType || "application/zip",
          "content-disposition": `attachment; filename="${fileName}"`,
          "cache-control": "private, no-store"
        }
      });
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.patch("/code-repositories/:owner/:name", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    const input = updateRepositorySchema.parse(await context.req.json());
    try {
      const { owner, name } = repositoryParams(context);
      const repository = await updateForgejoRepository(context.env, owner, name, input);
      await context.get("repo").createAuditLog({
        action: "code_repository.updated",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(repository.id),
        user,
        metadata: {
          fullName: repository.fullName,
          previousFullName: `${owner}/${name}`,
          changedFields: Object.keys(input),
          isPrivate: repository.isPrivate,
          isArchived: repository.isArchived
        }
      });
      return context.json(repository);
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });

  app.delete("/code-repositories/:owner/:name", async (context) => {
    const user = context.get("user");
    requirePermission(user, "delete", "settings");
    const input = deleteRepositorySchema.parse(await context.req.json());
    try {
      const { owner, name } = repositoryParams(context);
      if (input.confirmation !== name) return context.json({ error: "Type the repository name exactly to confirm deletion." }, 409);
      const detail = await readForgejoRepositoryDetail(context.env, createBackupStorage(context.env), owner, name);
      if (!detail.repository.isArchived) {
        return context.json({ error: "Archive the repository before deleting it permanently." }, 409);
      }
      await deleteForgejoRepository(context.env, owner, name);
      await context.get("repo").createAuditLog({
        action: "code_repository.deleted",
        entityType: "code_repository",
        entityId: repositoryAuditEntityId(detail.repository.id),
        user,
        metadata: { fullName: detail.repository.fullName, hadSnapshots: detail.snapshots.length > 0 }
      });
      return context.json({ ok: true });
    } catch (error) {
      return forgejoErrorResponse(context, error);
    }
  });
}
