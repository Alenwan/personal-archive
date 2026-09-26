import { randomBytes } from "node:crypto";
import { open, readFile } from "node:fs/promises";

try {
  const bundled = process.argv.length === 3 && process.argv[2] === "--bundled";
  if (!bundled && process.argv.length !== 2) throw new Error("Run without arguments, or with --bundled for the one-host installer.");
  let template = await readFile(new URL(".env.example", import.meta.url), "utf8");
  const names = ["COMPOSE_PROJECT_NAME", "POSTGRES_PASSWORD", "CREDENTIAL_ENCRYPTION_KEY", "MANUSCRIPT_RECOVERY_KEY", "PRIVATE_VAULT_RECOVERY_KEY"];
  if (bundled) names.push("GARAGE_RPC_SECRET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY");
  for (const name of names) {
    const value = name === "COMPOSE_PROJECT_NAME" ? `personal-archive-${randomBytes(6).toString("hex")}`
      : name === "S3_ACCESS_KEY_ID" ? `GK${randomBytes(16).toString("hex")}`
      : randomBytes(32).toString("hex");
    if (!template.includes(`${name}=''`)) throw new Error("Configuration template is invalid.");
    template = template.replace(`${name}=''`, `${name}='${value}'`);
  }
  if (bundled) {
    template = template.replace("S3_ENDPOINT=''", "S3_ENDPOINT='http://garage:3900'")
      .replace("S3_REGION='us-east-1'", "S3_REGION='garage'")
      .replace("DOCUMENT_BUCKET_NAME=''", "DOCUMENT_BUCKET_NAME='documents'")
      .replace("BACKUP_BUCKET_NAME=''", "BACKUP_BUCKET_NAME='backups'");
  }
  // Exclusive creation also rejects an existing symlink. Never rotate keys or
  // switch an established instance's volume identity on a repeated installation.
  const file = await open(".env", "wx", 0o600);
  try { await file.writeFile(template); await file.sync(); } finally { await file.close(); }
  console.log(bundled
    ? "Created private .env for bundled Garage storage. Preserve this file with database and object-store backups."
    : "Created private .env. Fill in the S3 connection and two bucket names before starting. Preserve this file with your encrypted recovery materials.");
} catch (error) {
  console.error(error?.code === "EEXIST" ? "Existing .env left unchanged. Initialization never replaces configuration or recovery keys." : "Configuration was not completed. Check the template and write access; keep any existing .env. No secrets were printed.");
  process.exitCode = 1;
}
