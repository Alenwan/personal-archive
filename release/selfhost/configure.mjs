import { randomBytes } from "node:crypto";
import { open, readFile } from "node:fs/promises";

try {
  if (process.argv.length !== 2) throw new Error("Run without arguments from the installation directory.");
  let template = await readFile(new URL(".env.example", import.meta.url), "utf8");
  for (const name of ["COMPOSE_PROJECT_NAME", "POSTGRES_PASSWORD", "CREDENTIAL_ENCRYPTION_KEY", "MANUSCRIPT_RECOVERY_KEY", "PRIVATE_VAULT_RECOVERY_KEY"]) {
    const value = name === "COMPOSE_PROJECT_NAME" ? `personal-archive-${randomBytes(6).toString("hex")}` : randomBytes(32).toString("hex");
    if (!template.includes(`${name}=''`)) throw new Error("Configuration template is invalid.");
    template = template.replace(`${name}=''`, `${name}='${value}'`);
  }
  // Exclusive creation also rejects an existing symlink. Never rotate keys or
  // switch an established instance's volume identity on a repeated installation.
  const file = await open(".env", "wx", 0o600);
  try { await file.writeFile(template); await file.sync(); } finally { await file.close(); }
  console.log("Created private .env. Fill in the S3 connection and two bucket names before starting. Preserve this file with your encrypted recovery materials.");
} catch (error) {
  console.error(error?.code === "EEXIST" ? "Existing .env left unchanged. Initialization never replaces configuration or recovery keys." : "Configuration was not completed. Check the template and write access; keep any existing .env. No secrets were printed.");
  process.exitCode = 1;
}
