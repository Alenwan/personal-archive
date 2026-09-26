import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  auditCandidates,
  classifyPaths,
  exitCodeFor,
  forbiddenPath,
  parseFindingReviews,
  parseManifest,
  readWorktreeCandidate,
  runAudit,
  scanText
} from "../scripts/audit-publication.mjs";

const gateIds = ["rights", "assets", "third-party", "privacy", "scope", "public-docs", "export-build", "history", "publication-authorization"];

function fixtureConfig() {
  return {
    version: 1,
    include: [{ pattern: "src/**", reason: "application-source" }, { pattern: "public/*.png", reason: "local-branding" }],
    exclude: [{ pattern: "src/internal/**", reason: "private-fixture" }],
    gates: gateIds.map((id) => ({ id, status: "pending", evidence: null as string | null }))
  };
}

function manifest(config: ReturnType<typeof fixtureConfig> & { binaryReviews?: { path: string; sha256: string; evidence: string }[] } = fixtureConfig()) {
  return `# Synthetic manifest\n\n\`\`\`publication-audit-v1\n${JSON.stringify(config)}\n\`\`\`\n`;
}

function withFixture(callback: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "personal-archive-publication-test-"));
  try { callback(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function put(root: string, path: string, content: string | Buffer) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function git(root: string, args: string[]) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" }
  });
}

function commit(root: string) {
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@" + "example.invalid", "commit", "-qm", "Synthetic fixture"]);
}

test("manifest requires one valid rule block and all explicit publication gates", () => {
  assert.equal(parseManifest(manifest()).version, 1);
  assert.throws(() => parseManifest("no executable manifest"));
  assert.throws(() => parseManifest(manifest() + manifest()));
  const missingGate = fixtureConfig();
  missingGate.gates.pop();
  assert.throws(() => parseManifest(manifest(missingGate)));
  const escaped = fixtureConfig();
  escaped.include[0].pattern = "../outside/**";
  assert.throws(() => parseManifest(manifest(escaped)));
  const incompleteEvidence = fixtureConfig();
  incompleteEvidence.gates[0].status = "complete";
  assert.throws(() => parseManifest(manifest(incompleteEvidence)));
});

test("exclude and protected paths win over broad candidate rules", () => {
  const config = fixtureConfig();
  config.include.push({ pattern: "**", reason: "synthetic-broad-rule" });
  const paths = ["src/good.ts", "src/internal/private.ts", ".env", "src/.env.production", "src/id_ed25519", "src/key.pem", "node_modules/package/index.js", ".git/config", ".tools/postgres-test-fixture/connection.json", "../outside.ts"];
  const classified = classifyPaths(paths, config);
  assert.equal(classified.filter((item: { disposition: string }) => item.disposition === "candidate").length, 1);
  for (const path of ["src/../outside.ts", "/absolute.ts", "src\\outside.ts", "src/file\n.ts"]) assert.equal(forbiddenPath(path), true);
  assert.equal(forbiddenPath(".env.example"), false);
});

test("reports only rule/path/line metadata for synthetic secret matches", () => {
  const syntheticToken = "gh" + "p_" + "A".repeat(36);
  const privateKeyMarker = "-----BEGIN " + "PRIVATE KEY-----";
  const syntheticPassword = "Synthetic" + "Password" + "Only";
  const text = ["safe", syntheticToken, privateKeyMarker, `password = '${syntheticPassword}'`].join("\n");
  const findings = scanText("src/fixture.ts", text);
  assert.deepEqual(findings.map((item: { rule: string; line: number }) => [item.rule, item.line]), [["provider-token", 2], ["private-key", 3], ["secret-literal", 4]]);
  const serialized = JSON.stringify(findings);
  for (const value of [syntheticToken, privateKeyMarker, syntheticPassword, "safe"]) assert.equal(serialized.includes(value), false);
  for (const item of findings) assert.deepEqual(Object.keys(item).sort(), ["line", "path", "rule", "severity"]);
});

test("private metadata and sample connection strings require review without failing ordinary CI", () => {
  const address = ["10", "20", "30", "40"].join(".");
  const text = [address, "/Users/" + "synthetic-owner/project", "member@" + "example.invalid", "postgresql://" + "sample:placeholder@localhost/db"].join("\n");
  const report = auditCandidates(["src/fixture.ts"], fixtureConfig(), () => ({ bytes: Buffer.from(text) }));
  assert.equal(report.checkPassed, true);
  assert.equal(report.counts.reviews, 4);
  assert.equal(report.publicationReviewPassed, false);
  assert.equal(exitCodeFor(report, "check"), 0);
  assert.equal(exitCodeFor(report, "publish-ready"), 2);
  assert.equal(JSON.stringify(report).includes(address), false);
});

test("pending provenance gates independently prevent a publish-ready result", () => {
  const report = auditCandidates(["src/good.ts"], fixtureConfig(), () => ({ bytes: Buffer.from("export const safe = 1;\n") }));
  assert.equal(report.counts.reviews, 0);
  assert.equal(report.counts.pendingGates, gateIds.length);
  assert.equal(exitCodeFor(report, "check"), 0);
  assert.equal(exitCodeFor(report, "publish-ready"), 2);
  assert.equal(report.publicationReviewPassed, false);
});

test("strong token findings fail checks without printing the matching value", () => {
  const value = "github_" + "pat_" + "B".repeat(40);
  const report = auditCandidates(["src/fixture.ts"], fixtureConfig(), () => ({ bytes: Buffer.from(value) }));
  assert.equal(exitCodeFor(report, "check"), 1);
  assert.equal(exitCodeFor(report, "publish-ready"), 1);
  assert.equal(JSON.stringify(report).includes(value), false);
});

test("excluded files are never passed to the content reader and inventory is deterministic", () => {
  const visited: string[] = [];
  const paths = [".env", "src/internal/private.ts", "src/z.ts", "src/a.ts", "src/a.ts", "docs/internal.md"];
  const report = auditCandidates(paths, fixtureConfig(), (path: string) => {
    visited.push(path);
    return { bytes: Buffer.from("safe") };
  });
  assert.deepEqual(visited, ["src/a.ts", "src/z.ts"]);
  assert.equal(report.counts.excluded, 3);
  const reordered = auditCandidates([...paths].reverse(), fixtureConfig(), () => ({ bytes: Buffer.from("safe") }));
  assert.deepEqual(report, reordered);
});

test("binary, oversized and non-UTF8 candidates remain explicitly unparsed", () => {
  const samples = new Map([
    ["public/image.png", Buffer.from("synthetic image placeholder")],
    ["src/binary.ts", Buffer.from([0, 1, 2])],
    ["src/encoding.ts", Buffer.from([0xff])],
    ["src/large.ts", Buffer.alloc(2 * 1024 * 1024 + 1, 65)]
  ]);
  const report = auditCandidates([...samples.keys()], fixtureConfig(), (path: string) => ({ bytes: samples.get(path) }));
  assert.equal(report.counts.scannedTextFiles, 0);
  assert.deepEqual(report.findings.map((item: { rule: string }) => item.rule).sort(), ["binary-unparsed", "binary-unparsed", "non-utf8-unparsed", "oversize-unparsed"]);
  assert.equal(exitCodeFor(report, "check"), 0);
  assert.equal(exitCodeFor(report, "publish-ready"), 2);
});

test("visual image review is bound to an exact image hash and cannot hide changed bytes", () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const review = { path: "public/image.png", sha256: createHash("sha256").update(image).digest("hex"), evidence: "Synthetic visual and metadata review" };
  const config = { ...fixtureConfig(), binaryReviews: [review], gates: gateIds.map((id) => ({ id, status: "complete", evidence: "Synthetic gate evidence" })) };
  assert.equal(parseManifest(manifest(config)).binaryReviews.length, 1);
  const report = auditCandidates([review.path], config, () => ({ bytes: image }));
  assert.equal(report.findings[0].rule, "binary-unparsed");
  assert.equal(report.findings[0].reviewed, true);
  assert.equal(report.counts.unresolvedReviews, 0);
  assert.equal(report.publicationReviewPassed, false); // no text file was scanned
  const changed = auditCandidates([review.path], config, () => ({ bytes: Buffer.concat([image, Buffer.from([0])]) }));
  assert.equal(changed.counts.staleReviews, 1);
  assert.equal(changed.counts.unresolvedReviews, 1);
  const absent = auditCandidates([], config, () => assert.fail("must not read"));
  assert.equal(absent.counts.staleReviews, 1);
  for (const invalid of [
    { ...review, path: "../private.png" },
    { ...review, path: "public/archive.zip" },
    { ...review, sha256: "invalid" },
    { ...review, evidence: " " }
  ]) assert.throws(() => parseManifest(manifest({ ...config, binaryReviews: [invalid] })));
  assert.throws(() => parseManifest(manifest({ ...config, binaryReviews: [review, review] })));
});

test("worktree reading rejects both file and directory symlinks before reading their targets", () => {
  withFixture((root) => {
    put(root, "outside/target.ts", "do not read this synthetic target");
    mkdirSync(join(root, "src"));
    symlinkSync(join(root, "outside/target.ts"), join(root, "src/file.ts"));
    symlinkSync(join(root, "outside"), join(root, "src/directory"));
    assert.equal(readWorktreeCandidate(root, "src/file.ts").finding?.rule, "symlink-not-read");
    assert.equal(readWorktreeCandidate(root, "src/directory/target.ts").finding?.rule, "symlink-not-read");
    assert.equal(readWorktreeCandidate(root, "../outside.ts").finding?.rule, "protected-path");
    assert.equal(readWorktreeCandidate(root, "src/missing.ts").finding?.rule, "file-unreadable");
  });
});

test("HEAD mode scans only selected HEAD files, excluding ancestors, other refs and working changes", () => {
  withFixture((root) => {
    git(root, ["init", "-q"]);
    put(root, "docs/open-source/PUBLICATION_MANIFEST.md", manifest());
    const token = "gh" + "p_" + "C".repeat(36);
    put(root, "src/example.ts", token);
    put(root, ".env", token);
    commit(root);
    git(root, ["branch", "synthetic-private-history"]);
    put(root, "src/example.ts", "safe current HEAD");
    commit(root);
    put(root, "src/example.ts", token);
    put(root, "src/uncommitted.ts", token);
    const head = runAudit(root, { head: true });
    assert.equal(head.checkPassed, true);
    assert.equal(head.counts.candidates, 1);
    assert.equal(head.counts.scannedTextFiles, 1);
    const working = runAudit(root);
    assert.equal(working.counts.errors, 2);
    assert.equal(working.counts.candidates, 2);
    assert.equal(JSON.stringify(working).includes(token), false);
  });
});

function fixtureReviews(content: string) {
  return { version: 1, files: [{ path: "src/example.ts", sha256: createHash("sha256").update(content).digest("hex"), reason: "Synthetic reserved-domain fixture", findings: [{ rule: "email-candidate", line: 1 }] }] };
}

test("exact content reviews retain raw findings and do not approve publication gates", () => {
  const content = "member@" + "example.invalid";
  const ledger = fixtureReviews(content);
  const config = fixtureConfig();
  const read = () => ({ bytes: Buffer.from(content) });
  const report = auditCandidates(["src/example.ts"], config, read, ledger);
  assert.equal(report.counts.reviews, 1);
  assert.equal(report.counts.reviewedReviews, 1);
  assert.equal(report.counts.unresolvedReviews, 0);
  assert.equal(report.counts.staleReviews, 0);
  assert.equal(report.findings[0].reviewed, true);
  assert.equal(exitCodeFor(report, "publish-ready"), 2);
  const complete = { ...config, gates: config.gates.map((gate) => ({ ...gate, status: "complete", evidence: "Synthetic test evidence only" })) };
  assert.equal(auditCandidates(["src/example.ts"], complete, read, ledger).publicationReviewPassed, true);
  const unreviewed = content + "\nother@" + "example.invalid";
  const extra = auditCandidates(["src/example.ts"], complete, () => ({ bytes: Buffer.from(unreviewed) }), fixtureReviews(unreviewed));
  assert.equal(extra.counts.unresolvedReviews, 1);
  assert.equal(extra.publicationReviewPassed, false);
});

test("changed content, shifted lines, removed paths and removed findings invalidate reviews", () => {
  const content = "member@" + "example.invalid";
  const config = fixtureConfig();
  config.gates = config.gates.map((gate) => ({ ...gate, status: "complete", evidence: "Synthetic test evidence only" }));
  const ledger = fixtureReviews(content);
  for (const [paths, changed] of [[ ["src/example.ts"], content + " // changed" ], [ ["src/example.ts"], "\n" + content ], [ ["src/other.ts"], content ], [ ["src/example.ts"], "safe" ]] as [string[], string][]) {
    const report = auditCandidates(paths, config, () => ({ bytes: Buffer.from(changed) }), ledger);
    assert.equal(report.counts.reviewedReviews, 0);
    assert.equal(report.counts.staleReviews, 1);
    assert.equal(exitCodeFor(report, "publish-ready"), 2);
    assert.equal(JSON.stringify(report).includes(content), false);
  }
});

test("review ledgers reject error, binary, gate, duplicate and malformed acknowledgments", () => {
  const ledger = fixtureReviews("member@" + "example.invalid");
  assert.deepEqual(parseFindingReviews(JSON.stringify(ledger)), ledger);
  for (const rule of ["provider-token", "private-key", "binary-unparsed", "oversize-unparsed", "gate-rights", "unknown"]) {
    const invalid = structuredClone(ledger);
    invalid.files[0].findings[0].rule = rule;
    assert.throws(() => auditCandidates([], fixtureConfig(), () => assert.fail("must not read"), invalid));
  }
  for (const mutate of [
    (value: typeof ledger) => { value.files.push(value.files[0]); },
    (value: typeof ledger) => { value.files[0].findings.push(value.files[0].findings[0]); },
    (value: typeof ledger) => { value.files[0].sha256 = "invalid"; },
    (value: typeof ledger) => { value.files[0].path = "../outside.ts"; },
    (value: typeof ledger) => { value.files[0].reason = " "; },
    (value: typeof ledger) => { value.files[0].findings[0].line = 0; }
  ]) {
    const invalid = structuredClone(ledger);
    mutate(invalid);
    assert.throws(() => parseFindingReviews(JSON.stringify(invalid)));
  }
  for (const value of ["null", "{}", "invalid", '{"version":1,"files":[null]}']) assert.throws(() => parseFindingReviews(value));
  assert.throws(() => parseManifest(manifest({ ...fixtureConfig(), reviewFile: "../outside.json" } as ReturnType<typeof fixtureConfig>)));
});

test("configured ledgers fail closed if unreadable and match HEAD bytes independently of worktree bytes", () => {
  withFixture((root) => {
    git(root, ["init", "-q"]);
    const reviewFile = "docs/open-source/reviews.json";
    put(root, "docs/open-source/PUBLICATION_MANIFEST.md", manifest({ ...fixtureConfig(), reviewFile } as ReturnType<typeof fixtureConfig>));
    const content = "member@" + "example.invalid";
    put(root, "src/example.ts", content);
    assert.throws(() => runAudit(root));
    put(root, "outside/reviews.json", JSON.stringify(fixtureReviews(content)));
    symlinkSync(join(root, "outside/reviews.json"), join(root, reviewFile));
    assert.throws(() => runAudit(root));
    rmSync(join(root, reviewFile));
    put(root, reviewFile, "invalid");
    assert.throws(() => runAudit(root));
    put(root, reviewFile, JSON.stringify(fixtureReviews(content)));
    commit(root);
    put(root, "src/example.ts", content + " // changed");
    assert.equal(runAudit(root, { head: true }).counts.reviewedReviews, 1);
    assert.equal(runAudit(root).counts.reviewedReviews, 0);
    assert.equal(runAudit(root).counts.staleReviews, 1);
  });
});
