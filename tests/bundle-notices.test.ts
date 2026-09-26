import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { bundleNotices } from "../scripts/bundleNotices.mjs";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function put(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
async function fixture(run: (root: string) => Promise<void>, entries: Record<string, string> = { "node_modules/example": "1.0.0" }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "archive-notices-")));
  try {
    const packages: Record<string, object> = {};
    for (const [path, version] of Object.entries(entries)) {
      const name = path.slice(path.lastIndexOf("node_modules/") + 13);
      packages[path] = { version, license: "MIT", integrity: "sha512-synthetic" };
      await put(root, `${path}/package.json`, JSON.stringify({ name, version }));
      await put(root, `${path}/LICENSE`, `Synthetic permission for ${name}@${version}\n`);
    }
    await put(root, "package-lock.json", JSON.stringify({ lockfileVersion: 3, packages }));
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("bundle notices preserve original texts, scoped/nested identities and deterministic hashes", async () => {
  const entries = { "node_modules/@scope/lib": "2.0.0", "node_modules/example": "1.0.0", "node_modules/example/node_modules/@scope/lib": "1.0.0" };
  await fixture(async (root) => {
    await put(root, "node_modules/@scope/lib/NOTICE.txt", "\uFEFFAdditional original attribution\r\n");
    const ids = Object.keys(entries).map((path) => join(root, path, "index.js"));
    const first = await bundleNotices(root, [...ids, ids[0], "src/app.ts"], "browser");
    const second = await bundleNotices(root, [...ids].reverse(), "browser");
    assert.deepEqual(first, second);
    const report = JSON.parse(first.json);
    assert.equal(report.components.length, 3);
    assert.equal(report.lockSha256, hash(await readFile(join(root, "package-lock.json"), "utf8")));
    const notice = report.components[0].notices.find((entry: { file: string }) => entry.file === "NOTICE.txt");
    assert.equal(notice.text, "\uFEFFAdditional original attribution\r\n");
    assert.equal(notice.sha256, hash(notice.text));
    assert.ok(first.text.includes(notice.text));
    assert.ok(!first.json.includes(root));
  }, entries);
});

test("bundle notices attribute injected build-tool code and refuse unknown virtual modules", async () => {
  await fixture(async (root) => {
    const report = JSON.parse((await bundleNotices(root, ["\0vite/preload-helper", "\0vite/modulepreload-polyfill", "\0commonjsHelpers.js", "\0plugin-vue:export-helper"], "browser")).json);
    assert.deepEqual(report.components.map((entry: { name: string }) => entry.name), ["@vitejs/plugin-vue", "vite"]);
    await assert.rejects(bundleNotices(root, ["\0new-third-party-helper"], "browser"), /Unmapped/);
    await rm(join(root, "node_modules/vite/LICENSE"));
    await assert.rejects(bundleNotices(root, ["\0vite/preload-helper"], "browser"), /no collected license/);
  }, { "node_modules/vite": "4.5.14", "node_modules/@vitejs/plugin-vue": "4.6.2" });
});

test("bundle notices refuse missing graph, unlocked dependencies, and changed package identities", async () => {
  await fixture(async (root) => {
    await assert.rejects(bundleNotices(root, [], "server"), /empty/);
    await assert.rejects(bundleNotices(root, ["node_modules/missing/index.js"], "server"), /absent/);
    await assert.rejects(bundleNotices(root, [join(root, "..", "node_modules/example/index.js")], "server"), /outside/);
    await put(root, "node_modules/example/package.json", JSON.stringify({ name: "example", version: "2.0.0" }));
    await assert.rejects(bundleNotices(root, ["node_modules/example/index.js"], "server"), /differs/);
  });
});

test("bundle notices refuse symlinked or empty attribution files", async () => {
  await fixture(async (root) => {
    await put(root, "node_modules/example/LICENSE", "\n");
    await assert.rejects(bundleNotices(root, ["node_modules/example/index.js"], "server"), /empty notice/);
    await rm(join(root, "node_modules/example/LICENSE"));
    await symlink("package.json", join(root, "node_modules/example/LICENSE"));
    await assert.rejects(bundleNotices(root, ["node_modules/example/index.js"], "server"), /symlink/);
  });
});

test("postgres fallback binds the exact upstream license text to the pinned version", async () => {
  await fixture(async (root) => {
    await rm(join(root, "node_modules/postgres/LICENSE"));
    const path = "release/licenses/postgres-3.4.9.UNLICENSE";
    const original = await readFile(join(process.cwd(), path), "utf8");
    await put(root, path, original);
    const result = JSON.parse((await bundleNotices(root, ["node_modules/postgres/src/index.js"], "server")).json);
    assert.equal(result.components[0].notices[0].text, original);
    assert.match(result.components[0].notices[0].source, /\/v3\.4\.9\/UNLICENSE$/);
    await put(root, path, original + "changed");
    await assert.rejects(bundleNotices(root, ["node_modules/postgres/src/index.js"], "server"), /checksum/);
  }, { "node_modules/postgres": "3.4.9" });
  await fixture(async (root) => {
    await rm(join(root, "node_modules/postgres/LICENSE"));
    await assert.rejects(bundleNotices(root, ["node_modules/postgres/src/index.js"], "server"), /no collected license/);
  }, { "node_modules/postgres": "3.4.10" });
});
