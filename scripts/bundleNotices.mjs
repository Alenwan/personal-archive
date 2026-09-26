import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const postgresLicense = {
  file: "release/licenses/postgres-3.4.9.UNLICENSE",
  source: "https://raw.githubusercontent.com/porsager/postgres/v3.4.9/UNLICENSE",
  sha256: "b5065838cbac452dfc855ba6e6e031481ad2c68406f70d21ead9321374653e6c"
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function regularFile(root, path) {
  const offset = relative(root, resolve(root, path));
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error("Notice input is outside the build root.");
  let current = root;
  for (const part of offset.split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Notice input must not be a symlink.");
  }
  const stat = await lstat(current);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Notice input is not a small regular file.");
  return readFile(current);
}

export async function bundleNotices(rootInput, moduleIds, target) {
  const root = await realpath(rootInput);
  const lockBytes = await regularFile(root, "package-lock.json");
  const lock = JSON.parse(lockBytes.toString("utf8"));
  const packagePaths = new Set();
  const injectedPackages = new Map([
    ["\0vite/modulepreload-polyfill", "node_modules/vite"],
    ["\0vite/preload-helper", "node_modules/vite"],
    ["\0plugin-vue:export-helper", "node_modules/@vitejs/plugin-vue"],
    // Vite bundles @rollup/plugin-commonjs; its LICENSE.md retains that notice.
    ["\0commonjsHelpers.js", "node_modules/vite"]
  ]);
  for (const id of moduleIds) {
    if (injectedPackages.has(id)) {
      const packagePath = injectedPackages.get(id);
      if (!lock.packages[packagePath]) throw new Error("Injected helper package is absent from package-lock.json.");
      packagePaths.add(packagePath);
      continue;
    }
    if (id.startsWith("\0")) throw new Error("Unmapped emitted virtual module; review its license attribution.");
    const path = relative(root, resolve(root, id.split("?")[0])).split(sep).join("/");
    if (!path.startsWith("node_modules/")) {
      if (path.includes("node_modules/")) throw new Error("Bundled dependency is outside the npm build root.");
      continue;
    }
    const marker = path.lastIndexOf("node_modules/") + "node_modules/".length;
    const segments = path.slice(marker).split("/");
    const name = segments.slice(0, segments[0].startsWith("@") ? 2 : 1).join("/");
    const packagePath = path.slice(0, marker) + name;
    if (!lock.packages[packagePath]) throw new Error("Bundled dependency is absent from package-lock.json.");
    packagePaths.add(packagePath);
  }
  if (!packagePaths.size) throw new Error("Dependency graph is empty; refusing an empty notice report.");
  const components = [];
  for (const packagePath of [...packagePaths].sort()) {
    const pinned = lock.packages[packagePath];
    const installed = JSON.parse((await regularFile(root, `${packagePath}/package.json`)).toString("utf8"));
    const expectedName = packagePath.slice(packagePath.lastIndexOf("node_modules/") + "node_modules/".length);
    if (installed.name !== expectedName || installed.version !== pinned.version || !pinned.license) {
      throw new Error("Bundled package identity or license metadata differs from the lock.");
    }
    const notices = [];
    const names = (await readdir(join(root, packagePath))).filter((name) => /^(?:licen[cs]e|unlicen[cs]e|copying|notice)(?:$|[._-])/i.test(name)).sort();
    for (const name of names) {
      const bytes = await regularFile(root, `${packagePath}/${name}`);
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (!text.trim()) throw new Error("A bundled dependency has an empty notice.");
      notices.push({ file: name, source: "installed-package", sha256: digest(bytes), text });
    }
    if (!notices.length && installed.name === "postgres" && installed.version === "3.4.9") {
      const bytes = await regularFile(root, postgresLicense.file);
      if (digest(bytes) !== postgresLicense.sha256) throw new Error("Vendored upstream license checksum differs.");
      notices.push({ file: "UNLICENSE", source: postgresLicense.source, sha256: digest(bytes), text: bytes.toString("utf8") });
    }
    if (!notices.length) throw new Error("A bundled dependency has no collected license text.");
    components.push({ packagePath, name: installed.name, version: installed.version,
      license: pinned.license, integrity: pinned.integrity ?? null, notices });
  }
  const heading = `Personal Archive — third-party notices (${target})\n\nCollected from packages represented in the JavaScript bundle graph.\nThis is not a complete source, operating-system, image, or asset SBOM.\nOriginal texts and multiple license alternatives are retained below.\nIt does not grant a license to Personal Archive itself.\n`;
  const text = heading + components.map((component) => `\n${"=".repeat(72)}\n${component.name}@${component.version}\nDeclared license: ${component.license}\nPackage: ${component.packagePath}\n` +
    component.notices.map((notice) => `\n--- ${notice.file} | SHA-256 ${notice.sha256} ---\n${notice.text}`).join("\n")).join("\n");
  const json = JSON.stringify({ format: "personal-archive-bundle-notices-v1", target,
    lockSha256: digest(lockBytes), components }, null, 2) + "\n";
  return { text, json };
}
