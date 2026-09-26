import type {
  CodeRepositoryBranch,
  CodeRepositoryCommit,
  CodeRepositoryCreateBranchInput,
  CodeRepositoryCreateInput,
  CodeRepositoryCreateTagInput,
  CodeRepositoryDetail,
  CodeRepositoryImportInput,
  CodeRepositoryOverview,
  CodeRepositoryRecord,
  CodeRepositoryRelease,
  CodeRepositorySnapshot,
  CodeRepositoryTag,
  CodeRepositoryUpdateInput,
  SystemStatusService
} from "../../shared/types";
import type { AppEnv } from "../env";
import type { DocumentStorage } from "../storage/documentStorage";

const requestTimeoutMs = 5_000;
const migrationTimeoutMs = 120_000;
const snapshotTimeoutMs = 120_000;
const maximumSnapshotBytes = 250 * 1024 * 1024;
const repositoriesPerPage = 50;
const maximumRepositoryPages = 20;
const maximumSnapshotsPerRepository = 20;

interface ForgejoVersionResponse {
  version?: string;
}

interface ForgejoRepositoryResponse {
  id?: number;
  owner?: { login?: string };
  name?: string;
  full_name?: string;
  description?: string | null;
  private?: boolean;
  archived?: boolean;
  empty?: boolean;
  mirror?: boolean;
  default_branch?: string;
  size?: number;
  updated_at?: string;
  html_url?: string;
  ssh_url?: string;
  clone_url?: string;
}

interface ForgejoBranchResponse {
  name?: string;
  protected?: boolean;
  commit?: { id?: string; timestamp?: string };
}

interface ForgejoCommitResponse {
  sha?: string;
  created?: string;
  html_url?: string;
  author?: { login?: string; full_name?: string };
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
    committer?: { name?: string; date?: string };
  };
}

interface ForgejoTagResponse {
  name?: string;
  message?: string;
  zipball_url?: string;
  commit?: { sha?: string };
}

interface ForgejoReleaseResponse {
  id?: number;
  name?: string;
  tag_name?: string;
  published_at?: string;
  created_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
}

interface SnapshotIndexEntry extends CodeRepositorySnapshot {
  archiveObjectKey: string;
  manifestObjectKey: string;
}

export class ForgejoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForgejoConfigurationError";
  }
}

export class ForgejoRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ForgejoRequestError";
  }
}

function cleanBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

function forgejoConfiguration(env: AppEnv) {
  const baseUrl = cleanBaseUrl(env.FORGEJO_BASE_URL);
  const publicUrl = cleanBaseUrl(env.FORGEJO_PUBLIC_URL) ?? baseUrl;
  const token = env.FORGEJO_API_TOKEN?.trim() ?? "";
  const owner = env.FORGEJO_OWNER?.trim() ?? "";
  const sshHost = env.FORGEJO_SSH_HOST?.trim() || (publicUrl ? new URL(publicUrl).hostname : "");
  const parsedSshPort = Number.parseInt(env.FORGEJO_SSH_PORT ?? "", 10);
  const sshPort = Number.isFinite(parsedSshPort) && parsedSshPort > 0 && parsedSshPort <= 65_535 ? parsedSshPort : 22;
  return {
    configured: Boolean(baseUrl && publicUrl && token && owner),
    baseUrl,
    publicUrl,
    token,
    owner,
    sshHost,
    sshPort
  };
}

export function isForgejoConfigured(env: AppEnv): boolean {
  return forgejoConfiguration(env).configured;
}

function repositoryPath(owner: string, name: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

async function forgejoFetch(
  env: AppEnv,
  path: string,
  init: RequestInit = {},
  timeoutMs = requestTimeoutMs
): Promise<Response> {
  const config = forgejoConfiguration(env);
  if (!config.configured || !config.baseUrl) {
    throw new ForgejoConfigurationError("The code repository service is not configured.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/api/v1${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `token ${config.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers
      }
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
      const detail = (payload?.message || payload?.error || response.statusText || "Forgejo request failed").slice(0, 240);
      throw new ForgejoRequestError(detail, response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof ForgejoRequestError || error instanceof ForgejoConfigurationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ForgejoRequestError("Forgejo did not respond before the request timed out.", 504);
    }
    throw new ForgejoRequestError(error instanceof Error ? error.message : "Forgejo is unavailable.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function forgejoRequest<T>(
  env: AppEnv,
  path: string,
  init: RequestInit = {},
  timeoutMs = requestTimeoutMs
): Promise<T> {
  const response = await forgejoFetch(env, path, init, timeoutMs);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function forgejoBinaryRequest(env: AppEnv, path: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const response = await forgejoFetch(
    env,
    path,
    { headers: { accept: "application/zip, application/octet-stream" } },
    snapshotTimeoutMs
  );
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maximumSnapshotBytes) {
    throw new ForgejoRequestError("The repository snapshot exceeds the 250 MB safety limit.", 413);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maximumSnapshotBytes) {
    throw new ForgejoRequestError("The repository snapshot exceeds the 250 MB safety limit.", 413);
  }
  return { bytes, contentType: response.headers.get("content-type") || "application/zip" };
}

function repositoryRecord(env: AppEnv, value: ForgejoRepositoryResponse): CodeRepositoryRecord {
  const config = forgejoConfiguration(env);
  const owner = value.owner?.login?.trim() || config.owner;
  const name = value.name?.trim() || "repository";
  const fullName = value.full_name?.trim() || `${owner}/${name}`;
  const encodedPath = fullName.split("/").map(encodeURIComponent).join("/");
  const webUrl = config.publicUrl ? `${config.publicUrl}/${encodedPath}` : value.html_url ?? "";
  const sshUrl = config.sshHost
    ? `ssh://git@${config.sshHost}:${config.sshPort}/${fullName}.git`
    : value.ssh_url ?? "";
  const cloneUrl = config.publicUrl ? `${config.publicUrl}/${encodedPath}.git` : value.clone_url ?? "";
  return {
    id: Number.isFinite(value.id) ? Number(value.id) : 0,
    owner,
    name,
    fullName,
    description: value.description?.trim() ?? "",
    isPrivate: value.private !== false,
    isArchived: value.archived === true,
    isEmpty: value.empty === true,
    isMirror: value.mirror === true,
    defaultBranch: value.default_branch?.trim() || "main",
    sizeBytes: Math.max(0, Number(value.size ?? 0)) * 1024,
    updatedAt: value.updated_at || new Date(0).toISOString(),
    webUrl,
    sshUrl,
    cloneUrl
  };
}

function branchRecord(value: ForgejoBranchResponse): CodeRepositoryBranch {
  return {
    name: value.name?.trim() || "branch",
    sha: value.commit?.id?.trim() || "",
    updatedAt: value.commit?.timestamp || new Date(0).toISOString(),
    isProtected: value.protected === true
  };
}

function commitRecord(value: ForgejoCommitResponse): CodeRepositoryCommit {
  const sha = value.sha?.trim() || "";
  const authorName =
    value.commit?.author?.name?.trim() || value.author?.full_name?.trim() || value.author?.login?.trim() || "Unknown author";
  return {
    sha,
    shortSha: sha.slice(0, 8),
    message: value.commit?.message?.trim() || "Commit",
    authorName,
    authoredAt: value.commit?.author?.date || value.commit?.committer?.date || value.created || new Date(0).toISOString(),
    webUrl: value.html_url?.trim() || ""
  };
}

function tagRecord(value: ForgejoTagResponse): CodeRepositoryTag {
  return {
    name: value.name?.trim() || "tag",
    sha: value.commit?.sha?.trim() || "",
    message: value.message?.trim() || "",
    archiveUrl: value.zipball_url?.trim() || ""
  };
}

function releaseRecord(value: ForgejoReleaseResponse): CodeRepositoryRelease {
  return {
    id: Number(value.id ?? 0),
    name: value.name?.trim() || value.tag_name?.trim() || "Release",
    tagName: value.tag_name?.trim() || "",
    publishedAt: value.published_at || value.created_at || new Date(0).toISOString(),
    isDraft: value.draft === true,
    isPrerelease: value.prerelease === true,
    webUrl: value.html_url?.trim() || ""
  };
}

async function safeForgejoList<T>(promise: Promise<T[]>): Promise<T[]> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ForgejoRequestError && (error.status === 404 || error.status === 409)) return [];
    throw error;
  }
}

async function listRepositories(env: AppEnv): Promise<CodeRepositoryRecord[]> {
  const repositories: ForgejoRepositoryResponse[] = [];
  for (let page = 1; page <= maximumRepositoryPages; page += 1) {
    const batch = await forgejoRequest<ForgejoRepositoryResponse[]>(
      env,
      `/user/repos?limit=${repositoriesPerPage}&page=${page}&sort=updated&order=desc`
    );
    repositories.push(...batch);
    if (batch.length < repositoriesPerPage) break;
  }
  return repositories
    .map((repository) => repositoryRecord(env, repository))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function readSnapshotIndex(storage: DocumentStorage, repositoryId: number): Promise<SnapshotIndexEntry[]> {
  const object = await storage.get(`forgejo/repositories/${repositoryId}/index.json`);
  if (!object) return [];
  try {
    const payload = (await new Response(object.body).json()) as { snapshots?: SnapshotIndexEntry[] };
    return Array.isArray(payload.snapshots) ? payload.snapshots : [];
  } catch {
    return [];
  }
}

async function writeSnapshotIndex(storage: DocumentStorage, repositoryId: number, entries: SnapshotIndexEntry[]): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify({ version: 1, snapshots: entries }, null, 2));
  await storage.put(`forgejo/repositories/${repositoryId}/index.json`, payload.buffer as ArrayBuffer, "application/json");
}

function publicSnapshot(entry: SnapshotIndexEntry): CodeRepositorySnapshot {
  const { archiveObjectKey: _archiveObjectKey, manifestObjectKey: _manifestObjectKey, ...snapshot } = entry;
  return snapshot;
}

export async function readForgejoOverview(env: AppEnv): Promise<CodeRepositoryOverview> {
  const config = forgejoConfiguration(env);
  if (!config.configured) {
    return {
      configured: false,
      status: "unavailable",
      version: null,
      owner: config.owner || null,
      webUrl: config.publicUrl,
      sshHost: config.sshHost || null,
      sshPort: config.sshPort,
      repositoryCount: 0,
      totalRepositoryBytes: 0,
      repositories: [],
      generatedAt: new Date().toISOString(),
      message: "Forgejo connection settings are incomplete."
    };
  }
  const [version, repositories] = await Promise.all([
    forgejoRequest<ForgejoVersionResponse>(env, "/version"),
    listRepositories(env)
  ]);
  return {
    configured: true,
    status: "healthy",
    version: version.version?.trim() || null,
    owner: config.owner,
    webUrl: config.publicUrl,
    sshHost: config.sshHost || null,
    sshPort: config.sshPort,
    repositoryCount: repositories.length,
    totalRepositoryBytes: repositories.reduce((total, repository) => total + repository.sizeBytes, 0),
    repositories,
    generatedAt: new Date().toISOString(),
    message: "Forgejo is connected and accepting API requests."
  };
}

export async function readForgejoRepositoryDetail(
  env: AppEnv,
  storage: DocumentStorage,
  owner: string,
  name: string
): Promise<CodeRepositoryDetail> {
  const path = repositoryPath(owner, name);
  const repositoryResponse = await forgejoRequest<ForgejoRepositoryResponse>(env, path);
  const repository = repositoryRecord(env, repositoryResponse);
  const [branches, commits, tags, releases, snapshots] = await Promise.all([
    safeForgejoList(forgejoRequest<ForgejoBranchResponse[]>(env, `${path}/branches?limit=100`)),
    safeForgejoList(
      forgejoRequest<ForgejoCommitResponse[]>(env, `${path}/commits?limit=20&stat=false&verification=false&files=false`)
    ),
    safeForgejoList(forgejoRequest<ForgejoTagResponse[]>(env, `${path}/tags?limit=100`)),
    safeForgejoList(forgejoRequest<ForgejoReleaseResponse[]>(env, `${path}/releases?limit=50`)),
    readSnapshotIndex(storage, repository.id)
  ]);
  return {
    repository,
    branches: branches.map(branchRecord),
    commits: commits.map(commitRecord),
    tags: tags.map(tagRecord),
    releases: releases.map(releaseRecord),
    snapshots: snapshots.map(publicSnapshot),
    generatedAt: new Date().toISOString()
  };
}

export async function readForgejoRepository(env: AppEnv, owner: string, name: string): Promise<CodeRepositoryRecord> {
  return repositoryRecord(env, await forgejoRequest<ForgejoRepositoryResponse>(env, repositoryPath(owner, name)));
}

export async function readForgejoServiceStatus(env: AppEnv): Promise<SystemStatusService> {
  if (!isForgejoConfigured(env)) {
    return { id: "code-repositories", label: "Code repositories", status: "unavailable", detail: "Forgejo is not configured" };
  }
  try {
    const response = await forgejoRequest<ForgejoVersionResponse>(env, "/version");
    return {
      id: "code-repositories",
      label: "Code repositories",
      status: "healthy",
      detail: response.version ? `Forgejo ${response.version}` : "Forgejo is responding"
    };
  } catch (error) {
    return {
      id: "code-repositories",
      label: "Code repositories",
      status: "unavailable",
      detail: error instanceof Error ? error.message : "Forgejo is unavailable"
    };
  }
}

export async function createForgejoRepository(env: AppEnv, input: CodeRepositoryCreateInput): Promise<CodeRepositoryRecord> {
  const repository = await forgejoRequest<ForgejoRepositoryResponse>(env, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? "",
      private: input.isPrivate !== false,
      auto_init: input.initialize === true,
      default_branch: "main"
    })
  });
  return repositoryRecord(env, repository);
}

export async function importForgejoRepository(env: AppEnv, input: CodeRepositoryImportInput): Promise<CodeRepositoryRecord> {
  const config = forgejoConfiguration(env);
  const repository = await forgejoRequest<ForgejoRepositoryResponse>(
    env,
    "/repos/migrate",
    {
      method: "POST",
      body: JSON.stringify({
        clone_addr: input.sourceUrl,
        repo_name: input.name,
        repo_owner: config.owner,
        description: input.description ?? "",
        private: input.isPrivate !== false,
        mirror: input.mirror === true,
        mirror_interval: input.mirror ? "8h0m0s" : undefined,
        service: "github",
        auth_token: input.sourceToken || undefined,
        issues: input.includeMetadata === true,
        labels: input.includeMetadata === true,
        milestones: input.includeMetadata === true,
        pull_requests: input.includeMetadata === true,
        releases: input.includeMetadata === true,
        wiki: input.includeMetadata === true
      })
    },
    migrationTimeoutMs
  );
  return repositoryRecord(env, repository);
}

export async function updateForgejoRepository(
  env: AppEnv,
  owner: string,
  name: string,
  input: CodeRepositoryUpdateInput
): Promise<CodeRepositoryRecord> {
  const repository = await forgejoRequest<ForgejoRepositoryResponse>(env, repositoryPath(owner, name), {
    method: "PATCH",
    body: JSON.stringify({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.defaultBranch !== undefined ? { default_branch: input.defaultBranch } : {}),
      ...(input.isPrivate !== undefined ? { private: input.isPrivate } : {}),
      ...(input.isArchived !== undefined ? { archived: input.isArchived } : {})
    })
  });
  return repositoryRecord(env, repository);
}

export async function createForgejoBranch(
  env: AppEnv,
  owner: string,
  name: string,
  input: CodeRepositoryCreateBranchInput
): Promise<CodeRepositoryBranch> {
  const branch = await forgejoRequest<ForgejoBranchResponse>(env, `${repositoryPath(owner, name)}/branches`, {
    method: "POST",
    body: JSON.stringify({ new_branch_name: input.name, old_ref_name: input.sourceRef || undefined })
  });
  return branchRecord(branch);
}

export async function deleteForgejoBranch(env: AppEnv, owner: string, name: string, branch: string): Promise<void> {
  await forgejoRequest<void>(env, `${repositoryPath(owner, name)}/branches/${encodeURIComponent(branch)}`, { method: "DELETE" });
}

export async function createForgejoTag(
  env: AppEnv,
  owner: string,
  name: string,
  input: CodeRepositoryCreateTagInput
): Promise<CodeRepositoryTag> {
  const tag = await forgejoRequest<ForgejoTagResponse>(env, `${repositoryPath(owner, name)}/tags`, {
    method: "POST",
    body: JSON.stringify({ tag_name: input.name, target: input.target || undefined, message: input.message || "" })
  });
  return tagRecord(tag);
}

export async function deleteForgejoTag(env: AppEnv, owner: string, name: string, tag: string): Promise<void> {
  await forgejoRequest<void>(env, `${repositoryPath(owner, name)}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" });
}

export async function deleteForgejoRepository(env: AppEnv, owner: string, name: string): Promise<void> {
  await forgejoRequest<void>(env, repositoryPath(owner, name), { method: "DELETE" });
}

export async function createForgejoRepositorySnapshot(
  env: AppEnv,
  storage: DocumentStorage,
  owner: string,
  name: string
): Promise<CodeRepositorySnapshot> {
  const detail = await readForgejoRepositoryDetail(env, storage, owner, name);
  if (detail.repository.isEmpty) throw new ForgejoRequestError("An empty repository has no source to snapshot.", 409);
  const ref = detail.repository.defaultBranch;
  const archiveName = `${encodeURIComponent(ref)}.zip`;
  const archive = await forgejoBinaryRequest(env, `${repositoryPath(owner, name)}/archive/${archiveName}`);
  const createdAt = new Date().toISOString();
  const compactTimestamp = createdAt.replaceAll("-", "").replaceAll(":", "").replaceAll(".", "");
  const snapshotId = `${compactTimestamp}-${crypto.randomUUID().slice(0, 8)}`;
  const baseKey = `forgejo/repositories/${detail.repository.id}/${snapshotId}`;
  const archiveObjectKey = `${baseKey}/${detail.repository.name}-${ref.replace(/[^A-Za-z0-9._-]/g, "-")}.zip`;
  const manifestObjectKey = `${baseKey}/manifest.json`;
  const entry: SnapshotIndexEntry = {
    snapshotId,
    repositoryId: detail.repository.id,
    fullName: detail.repository.fullName,
    ref,
    createdAt,
    archiveBytes: archive.bytes.byteLength,
    archiveObjectKey,
    manifestObjectKey
  };
  const manifest = new TextEncoder().encode(
    JSON.stringify(
      {
        version: 1,
        createdAt,
        repository: detail.repository,
        branches: detail.branches,
        tags: detail.tags,
        releases: detail.releases,
        recentCommits: detail.commits,
        sourceArchive: { ref, bytes: archive.bytes.byteLength, objectKey: archiveObjectKey },
        recoveryBoundary:
          "This snapshot contains the default branch source and repository metadata. Use the host Forgejo backup for full Git history and service recovery."
      },
      null,
      2
    )
  );
  await storage.put(archiveObjectKey, archive.bytes, archive.contentType);
  try {
    await storage.put(manifestObjectKey, manifest.buffer as ArrayBuffer, "application/json");
    const previous = await readSnapshotIndex(storage, detail.repository.id);
    const retained = [entry, ...previous.filter((item) => item.snapshotId !== snapshotId)];
    const expired = retained.slice(maximumSnapshotsPerRepository);
    await writeSnapshotIndex(storage, detail.repository.id, retained.slice(0, maximumSnapshotsPerRepository));
    await Promise.allSettled(
      expired.flatMap((item) => [storage.delete(item.archiveObjectKey), storage.delete(item.manifestObjectKey)])
    );
  } catch (error) {
    await Promise.allSettled([storage.delete(archiveObjectKey), storage.delete(manifestObjectKey)]);
    throw error;
  }
  return publicSnapshot(entry);
}

export async function readForgejoSnapshotObject(
  storage: DocumentStorage,
  repositoryId: number,
  snapshotId: string
): Promise<{ snapshot: CodeRepositorySnapshot; object: NonNullable<Awaited<ReturnType<DocumentStorage["get"]>>> } | null> {
  const entries = await readSnapshotIndex(storage, repositoryId);
  const entry = entries.find((item) => item.snapshotId === snapshotId);
  if (!entry) return null;
  const object = await storage.get(entry.archiveObjectKey);
  if (!object) return null;
  return { snapshot: publicSnapshot(entry), object };
}
