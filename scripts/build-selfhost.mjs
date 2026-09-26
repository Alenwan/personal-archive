import fs from "node:fs/promises";
import esbuild from "esbuild";
import { readMigrations } from "../src/server/services/schemaMigrations.ts";
import { bundleNotices } from "./bundleNotices.mjs";

await fs.rm("dist-server", { recursive: true, force: true });
const result = await esbuild.build({
  entryPoints: {
    selfhost: "server/selfhost.ts",
    migrate: "scripts/migrate.mjs",
    "init-admin": "scripts/init-admin.mjs",
    "manage-users": "scripts/manage-users.mjs",
    "set-user-password": "scripts/set-user-password.mjs",
    "claim-manuscript-key-owner": "scripts/claim-manuscript-key-owner.mjs"
  },
  bundle: true,
  metafile: true,
  platform: "node",
  format: "esm",
  target: "node22",
  define: { __ARCHIVE_MIGRATIONS__: JSON.stringify((await readMigrations("migrations")).map(({ name, sha256 }) => ({ name, sha256 }))) },
  outdir: "dist-server",
  outExtension: { ".js": ".mjs" },
  logLevel: "info"
});
const modules = Object.values(result.metafile.outputs).flatMap((output) =>
  Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([id]) => id));
const notices = await bundleNotices(process.cwd(), modules, "server");
await fs.writeFile("dist-server/THIRD_PARTY_NOTICES.txt", notices.text);
await fs.writeFile("dist-server/THIRD_PARTY_COMPONENTS.json", notices.json);
