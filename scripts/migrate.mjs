import postgres from "postgres";
import { readMigrations, migrateDatabase } from "../src/server/services/schemaMigrations.ts";

const databaseUrl = process.env.DATABASE_URL;
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--adopt-legacy-checksums")) throw new Error("Unknown migration argument.");
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const databaseSsl = (process.env.DATABASE_SSL ?? "true").toLowerCase();
const sql = postgres(databaseUrl, {
  max: 1, connect_timeout: 10,
  ssl: databaseSsl === "false" || databaseSsl === "disable" ? false : "require",
  onnotice: () => {}
});
try {
  const migrations = await readMigrations("migrations");
  const count = await migrateDatabase(sql, migrations, args.includes("--adopt-legacy-checksums"));
  console.log(`Migrations complete: ${count} applied; ${migrations.length} checksums verified.`);
} catch {
  console.error("Migration failed. Check database access, migration history/checksums and exclusive migration access. No later migration was applied.");
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
