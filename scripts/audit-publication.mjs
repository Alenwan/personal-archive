import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_PATH = "docs/open-source/PUBLICATION_MANIFEST.md";
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const REQUIRED_GATES = ["rights", "assets", "third-party", "privacy", "scope", "public-docs", "export-build", "history", "publication-authorization"];
const BINARY_EXTENSION = /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|docx|xlsx|epub|woff2?|ttf|mp[34]|mov)$/i;
const RULES = [
  { id: "private-key", severity: "error", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: "provider-token", severity: "error", pattern: /(?:\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b)/ },
  { id: "credential-url", severity: "review", pattern: /(?:postgres(?:ql)?|mysql|https?):\/\/[^\s/"'`]+:[^\s/@"'`]+@/ },
  { id: "private-network", severity: "review", pattern: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/ },
  { id: "personal-path", severity: "review", pattern: /(?:\/Users\/[^/\s"'`]+|\/home\/[^/\s"'`]+|[A-Za-z]:\\Users\\[^\\\s"'`]+)/ },
  { id: "email-candidate", severity: "review", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { id: "secret-literal", severity: "review", pattern: /\b(?:[A-Za-z0-9_]*(?:password|secret|token|api_key|access_key)[A-Za-z0-9_]*)\s*[=:]\s*["'`][^\s"'`]{6,}["'`]/i }
];

export function validRelativePath(path) {
  return typeof path === "string" && path.length > 0 && !isAbsolute(path) && !path.includes("\\") &&
    !/[\x00-\x1f\x7f]/.test(path) && !path.split("/").some((part) => !part || part === "." || part === "..");
}

export function forbiddenPath(path) {
  if (!validRelativePath(path)) return true;
  const parts = path.split("/");
  return parts.some((part) => [".git", ".worktrees", ".tools", "node_modules", "dist", "dist-server", ".wrangler", "postgres-data", "minio-data", "uploads"].includes(part)) ||
    parts.some((part) => part === ".dev.vars" || (part.startsWith(".env") && part !== ".env.example")) ||
    /(?:^|\/)(?:id_rsa|id_ed25519)(?:\.|$)/.test(path) || /\.(?:pem|key|p12|pfx|dump|sql\.gz|log)$/i.test(path);
}

function globMatches(path, glob) {
  const expression = glob.split("/").map((part) => {
    if (part === "**") return ".*";
    return part.split("*").map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  }).join("/");
  return new RegExp(`^${expression}$`).test(path);
}

export function parseManifest(markdown) {
  const blocks = [...markdown.matchAll(/```publication-audit-v1\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) throw new Error("manifest-invalid");
  let config;
  try { config = JSON.parse(blocks[0][1]); } catch { throw new Error("manifest-invalid"); }
  if (config.version !== 1 || !Array.isArray(config.include) || !config.include.length || !Array.isArray(config.exclude) || !Array.isArray(config.gates)) {
    throw new Error("manifest-invalid");
  }
  for (const entry of [...config.include, ...config.exclude]) {
    if (!validRelativePath(entry.pattern) || typeof entry.reason !== "string" || !/^[a-z0-9-]+$/.test(entry.reason)) throw new Error("manifest-invalid");
  }
  if (config.reviewFile !== undefined && forbiddenPath(config.reviewFile)) throw new Error("manifest-invalid");
  const gateIds = config.gates.map((gate) => gate.id);
  if (new Set(gateIds).size !== gateIds.length || REQUIRED_GATES.some((id) => !gateIds.includes(id)) || gateIds.some((id) => !REQUIRED_GATES.includes(id))) {
    throw new Error("manifest-invalid");
  }
  for (const gate of config.gates) {
    if (!["pending", "complete"].includes(gate.status) || (gate.status === "complete" && (typeof gate.evidence !== "string" || !gate.evidence.trim()))) {
      throw new Error("manifest-invalid");
    }
  }
  if (config.binaryReviews !== undefined) {
    if (!Array.isArray(config.binaryReviews)) throw new Error("manifest-invalid");
    const seen = new Set();
    for (const review of config.binaryReviews) {
      if (!review || !validRelativePath(review.path) || forbiddenPath(review.path) || !/\.(?:png|jpe?g)$/i.test(review.path) ||
          !/^[a-f0-9]{64}$/.test(review.sha256) || typeof review.evidence !== "string" || !review.evidence.trim() || seen.has(review.path)) {
        throw new Error("manifest-invalid");
      }
      seen.add(review.path);
    }
  }
  return config;
}

// A review is specific to one finding in one exact file, never a path-wide exemption.
export function parseFindingReviews(text) {
  let ledger;
  try { ledger = JSON.parse(text); } catch { throw new Error("finding-reviews-invalid"); }
  if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.files)) throw new Error("finding-reviews-invalid");
  const reviewRules = new Set(RULES.filter((rule) => rule.severity === "review").map((rule) => rule.id));
  const paths = new Set();
  for (const file of ledger.files) {
    if (!file || forbiddenPath(file.path) || paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        typeof file.reason !== "string" || !file.reason.trim() || !Array.isArray(file.findings) || !file.findings.length) {
      throw new Error("finding-reviews-invalid");
    }
    paths.add(file.path);
    const keys = new Set();
    for (const item of file.findings) {
      if (!item || !reviewRules.has(item.rule) || !Number.isSafeInteger(item.line) || item.line < 1) throw new Error("finding-reviews-invalid");
      const key = `${item.rule}:${item.line}`;
      if (keys.has(key)) throw new Error("finding-reviews-invalid");
      keys.add(key);
    }
  }
  return ledger;
}

export function classifyPaths(paths, config) {
  return [...new Set(paths)].sort().map((path) => {
    if (forbiddenPath(path)) return { path, disposition: "excluded", reason: "protected-path" };
    const excluded = config.exclude.find((entry) => globMatches(path, entry.pattern));
    if (excluded) return { path, disposition: "excluded", reason: excluded.reason };
    const included = config.include.find((entry) => globMatches(path, entry.pattern));
    if (included) return { path, disposition: "candidate", reason: included.reason };
    return { path, disposition: "excluded", reason: "not-allow-listed" };
  });
}

export function scanText(path, text) {
  const findings = [];
  for (const [index, line] of text.split(/\r\n|\n|\r/).entries()) {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) findings.push({ path, rule: rule.id, line: index + 1, severity: rule.severity });
    }
  }
  return findings;
}

function finding(path, rule, severity = "error") {
  return { path, rule, line: null, severity };
}

// Refuse symlinks at every component before opening a candidate. Do not read excluded paths.
export function readWorktreeCandidate(root, path) {
  if (forbiddenPath(path)) return { finding: finding(path, "protected-path") };
  const boundary = realpathSync(root);
  let current = boundary;
  try {
    const parts = path.split("/");
    for (const [index, part] of parts.entries()) {
      current = resolve(current, part);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) return { finding: finding(path, "symlink-not-read") };
      if (index < parts.length - 1 && !stat.isDirectory()) return { finding: finding(path, "not-regular-file") };
      if (index === parts.length - 1) {
        if (!stat.isFile()) return { finding: finding(path, "not-regular-file") };
        if (stat.size > MAX_TEXT_BYTES) return { finding: finding(path, "oversize-unparsed", "review") };
      }
    }
    const resolved = realpathSync(current);
    const offset = relative(boundary, resolved);
    if (offset.startsWith(`..${sep}`) || offset === ".." || isAbsolute(offset)) return { finding: finding(path, "outside-worktree") };
    if (BINARY_EXTENSION.test(path)) return { bytes: readFileSync(resolved), finding: finding(path, "binary-unparsed", "review") };
    return { bytes: readFileSync(resolved) };
  } catch {
    return { finding: finding(path, "file-unreadable") };
  }
}

/** @param {unknown} [findingReviews] Validated before any candidate is read. */
export function auditCandidates(paths, config, readCandidate, findingReviews = { version: 1, files: [] }) {
  const ledger = parseFindingReviews(JSON.stringify(findingReviews));
  const inventory = classifyPaths(paths, config);
  const findings = [];
  const hashes = new Map();
  let scannedTextFiles = 0;
  for (const item of inventory) {
    if (item.disposition !== "candidate") continue;
    const result = readCandidate(item.path);
    if (result.finding) {
      if (result.finding.rule === "binary-unparsed" && result.bytes) hashes.set(item.path, createHash("sha256").update(result.bytes).digest("hex"));
      findings.push(result.finding);
      continue;
    }
    const bytes = result.bytes;
    if (!bytes || bytes.byteLength > MAX_TEXT_BYTES) { findings.push(finding(item.path, "oversize-unparsed", "review")); continue; }
    if (BINARY_EXTENSION.test(item.path) || bytes.includes(0)) {
      hashes.set(item.path, createHash("sha256").update(bytes).digest("hex"));
      findings.push(finding(item.path, "binary-unparsed", "review"));
      continue;
    }
    let content;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { findings.push(finding(item.path, "non-utf8-unparsed", "review")); continue; }
    scannedTextFiles += 1;
    hashes.set(item.path, createHash("sha256").update(bytes).digest("hex"));
    findings.push(...scanText(item.path, content));
  }
  findings.sort((a, b) => a.path.localeCompare(b.path, "en") || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule, "en"));
  const errors = findings.filter((item) => item.severity === "error").length;
  const reviews = findings.filter((item) => item.severity === "review").length;
  const staleReviews = [];
  for (const file of ledger.files) {
    for (const entry of file.findings) {
      const match = findings.find((item) => item.path === file.path && item.rule === entry.rule && item.line === entry.line && item.severity === "review");
      if (hashes.get(file.path) === file.sha256 && match) match.reviewed = true;
      else staleReviews.push({ path: file.path, rule: entry.rule, line: entry.line });
    }
  }
  for (const review of config.binaryReviews ?? []) {
    const match = findings.find((item) => item.path === review.path && item.rule === "binary-unparsed" && item.severity === "review");
    if (hashes.get(review.path) === review.sha256 && match) match.reviewed = true;
    else staleReviews.push({ path: review.path, rule: "binary-unparsed", line: null });
  }
  staleReviews.sort((a, b) => a.path.localeCompare(b.path, "en") || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule, "en"));
  const reviewedReviews = findings.filter((item) => item.reviewed).length;
  const unresolvedReviews = reviews - reviewedReviews;
  const gates = config.gates.filter((gate) => gate.status !== "complete").map((gate) => ({ path: MANIFEST_PATH, rule: `gate-${gate.id}`, line: null, severity: "review" }));
  return {
    checkPassed: errors === 0,
    publicationReviewPassed: errors === 0 && unresolvedReviews === 0 && staleReviews.length === 0 && gates.length === 0 && scannedTextFiles > 0,
    counts: { candidates: inventory.filter((item) => item.disposition === "candidate").length, excluded: inventory.filter((item) => item.disposition === "excluded").length, scannedTextFiles, errors, reviews, reviewedReviews, unresolvedReviews, staleReviews: staleReviews.length, pendingGates: gates.length },
    findings,
    staleReviews,
    gates,
    inventory
  };
}

export function exitCodeFor(report, mode) {
  if (!report.checkPassed) return 1;
  return mode === "publish-ready" && !report.publicationReviewPassed ? 2 : 0;
}

function git(root, args, encoding = "utf8") {
  // No network commands, arbitrary refs, external filters or inherited Git directory overrides.
  return execFileSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
    encoding,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" }
  });
}

export function runAudit(root, { head = false } = {}) {
  const manifest = readWorktreeCandidate(root, MANIFEST_PATH);
  if (!manifest.bytes) throw new Error("manifest-unreadable");
  const config = parseManifest(new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes));
  let ledger;
  if (config.reviewFile !== undefined) {
    const result = readWorktreeCandidate(root, config.reviewFile);
    if (!result.bytes) throw new Error("finding-reviews-unreadable");
    ledger = parseFindingReviews(new TextDecoder("utf-8", { fatal: true }).decode(result.bytes));
  }
  let paths;
  let reader;
  if (head) {
    // Only HEAD's tree, not its ancestors, tags, branches, reflog or other worktrees.
    const entries = git(root, ["ls-tree", "-r", "-z", "HEAD"]).split("\0").filter(Boolean).map((row) => {
      const tab = row.indexOf("\t");
      const [mode, type, oid] = row.slice(0, tab).split(" ");
      return { path: row.slice(tab + 1), mode, type, oid };
    });
    paths = entries.map((entry) => entry.path);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    reader = (path) => {
      const entry = byPath.get(path);
      if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) return { finding: finding(path, "nonregular-git-entry-not-read") };
      const size = Number(git(root, ["cat-file", "-s", entry.oid]).trim());
      if (!Number.isSafeInteger(size) || size > MAX_TEXT_BYTES) return { finding: finding(path, "oversize-unparsed", "review") };
      const bytes = git(root, ["cat-file", "blob", entry.oid], null);
      return BINARY_EXTENSION.test(path) ? { bytes, finding: finding(path, "binary-unparsed", "review") } : { bytes };
    };
  } else {
    paths = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
    reader = (path) => readWorktreeCandidate(root, path);
  }
  return auditCandidates(paths, config, reader, ledger);
}

function main(args) {
  const known = new Set(["--check", "--publish-ready", "--head", "--list"]);
  if (args.some((arg) => !known.has(arg)) || (args.includes("--check") && args.includes("--publish-ready"))) {
    process.stdout.write(`${JSON.stringify({ path: "scripts/audit-publication.mjs", rule: "invalid-arguments", line: null })}\n`);
    return 1;
  }
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const report = runAudit(root, { head: args.includes("--head") });
    const { inventory, ...summary } = report;
    process.stdout.write(`${JSON.stringify({ scope: args.includes("--head") ? "HEAD-tree-only" : "selected-worktree", ...summary, ...(args.includes("--list") ? { inventory } : {}) }, null, 2)}\n`);
    return exitCodeFor(report, args.includes("--publish-ready") ? "publish-ready" : "check");
  } catch {
    // Never print exceptions, child stderr, file contents, environment values or matching text.
    process.stdout.write(`${JSON.stringify({ path: MANIFEST_PATH, rule: "audit-incomplete", line: null })}\n`);
    return 1;
  }
}

// The filename guard also prevents the CLI running when bundled into a node:test module.
if (basename(fileURLToPath(import.meta.url)) === "audit-publication.mjs" && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
