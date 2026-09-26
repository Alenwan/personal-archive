import { lstat, readFile } from "node:fs/promises";
import postgres from "postgres";
import { PostgresRepository } from "../src/server/repositories/postgres.ts";
import { manuscriptKeyOwnerClaimSchema } from "../src/server/auth/manuscriptKeyOwnership.ts";

// Maintenance only: no HTTP endpoint or server-held recovery key is involved.
// Default is a read-only inventory, including deleted legacy works.
const args = process.argv.slice(2);
const usage = "Usage: claim-manuscript-key-owner [--claim-file review.json [--apply --writers-stopped]]";
let claimFile;
let apply = false;
let stopped = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--claim-file" && !claimFile && args[index + 1] && !args[index + 1].startsWith("--")) claimFile = args[++index];
  else if (arg === "--apply" && !apply) apply = true;
  else if (arg === "--writers-stopped" && !stopped) stopped = true;
  else { console.error(usage); process.exit(1); }
}
if ((apply && (!claimFile || !stopped)) || (stopped && !apply)) {
  console.error(usage); process.exit(1);
}
if (process.env.BUSINESS_TEMPLATE !== "personal-archive" || !process.env.DATABASE_URL) {
  console.error("Explicit Personal Archive BUSINESS_TEMPLATE and DATABASE_URL are required."); process.exit(1);
}
let claim;
try {
  if (claimFile) {
    const stat = await lstat(claimFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error();
    claim = manuscriptKeyOwnerClaimSchema.parse(JSON.parse(await readFile(claimFile, "utf8")));
  }
} catch { console.error("Invalid ownership review file. Use IDs, an exact inventory timestamp and evidence/operator references only."); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, {
  max: 1, connect_timeout: 10, onnotice: () => {},
  ssl: ["false", "disable"].includes((process.env.DATABASE_SSL ?? "true").toLowerCase()) ? false : "require"
});
try {
  const repo = new PostgresRepository(sql);
  if (claim && apply) {
    await repo.claimManuscriptKeyOwner(claim);
    console.log(JSON.stringify({ applied: true, manuscriptId: claim.manuscriptId, ownerUserId: claim.ownerUserId }));
  } else {
    const inventory = await repo.listUnresolvedManuscriptKeyOwnership();
    if (claim) {
      const candidate = inventory.find((item) => item.manuscriptId === claim.manuscriptId);
      const users = await sql`select user_id from users where user_id = ${claim.ownerUserId}`;
      if (!candidate || candidate.expectedUpdatedAt !== claim.expectedUpdatedAt || !users.length) throw new Error();
      console.log(JSON.stringify({ applied: false, review: claim, candidate }));
    } else console.log(JSON.stringify({ applied: false, unresolved: inventory }));
  }
} catch {
  console.error("Ownership review failed. Verify the schema, target account and fresh unresolved inventory. No partial claim was applied.");
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
