import { build } from "esbuild";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

// No application configuration or credentials are inherited by test workers.
// Database integration gets its disposable target from its own launcher.
const root = process.cwd();
const names = (await readdir(join(root, "tests"))).filter((name) => name.endsWith(".test.ts")).sort();
const selected = process.argv.slice(2);
const files = names.filter((name) => !selected.length || selected.some((part) => name.includes(part)));
if (!files.length) throw new Error("No matching tests; refusing to report an empty suite as passing.");
await mkdir(join(root, ".tools"), { recursive: true });
const outdir = await mkdtemp(join(root, ".tools", "test-"));
try {
  await build({
    entryPoints: files.map((name) => join(root, "tests", name)),
    outdir,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node22",
    outExtension: { ".js": ".mjs" },
    plugins: [{
      name: "preserve-script-module-identity",
      setup(builder) {
        builder.onResolve({ filter: /\.mjs$/ }, (args) => args.path.startsWith(".")
          ? { path: resolve(args.resolveDir, args.path), external: true }
          : undefined);
      }
    }]
  });
  const env = { NODE_ENV: "test", PATH: process.env.PATH ?? "" };
  for (const key of ["SystemRoot", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const child = spawn(process.execPath, ["--test", ...files.map((name) => join(outdir, name.replace(/\.ts$/, ".mjs")))], {
    cwd: root, env, stdio: "inherit"
  });
  process.exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  await rm(outdir, { recursive: true, force: true });
}
