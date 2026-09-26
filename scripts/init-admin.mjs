import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import postgres from "postgres";
import { AdminInitializationError, initializeAdmin } from "../src/server/auth/initializeAdmin.ts";
import { readMigrations } from "../src/server/services/schemaMigrations.ts";

const help = `Initialize the first Personal Archive administrator on a migrated, empty instance.
Usage: node dist-server/init-admin.mjs --email owner@example.org [--name "Archive Owner"]
       Add --password-stdin to read one password line from a secret manager or protected pipe.
Requires BUSINESS_TEMPLATE=personal-archive and DATABASE_URL; DATABASE_SSL defaults to require.
The default terminal prompt hides password input and asks for confirmation.
Passwords are never accepted as arguments or from PASSWORD. Existing accounts are never reset.`;

function options(args) {
  const result = { name: "Archive Owner", email: "", stdin: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (seen.has(flag)) throw new AdminInitializationError("Duplicate argument. Use --help.");
    seen.add(flag);
    if (flag === "--password-stdin") result.stdin = true;
    else if (["--email", "--name"].includes(flag) && args[i + 1] && !args[i + 1].startsWith("--")) result[flag.slice(2)] = args[++i];
    else throw new AdminInitializationError("Unknown or incomplete argument. Use --help.");
  }
  if (!result.email) throw new AdminInitializationError("--email is required. Use --help.");
  return result;
}

async function readPasswordFromPipe() {
  if (process.stdin.isTTY) throw new AdminInitializationError("--password-stdin requires a pipe; omit it for an interactive prompt.");
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    value += chunk;
    if (Buffer.byteLength(value) > 4096) throw new AdminInitializationError("Password input is too long.");
  }
  value = value.replace(/\r?\n$/, "");
  if (!value || /[\r\n]/.test(value)) throw new AdminInitializationError("Supply exactly one password line.");
  return value;
}

async function promptPassword() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new AdminInitializationError("An interactive terminal is required; use --password-stdin for a protected pipe.");
  // readline still handles editing/interrupts; its output is discarded so it
  // cannot echo typed or pasted secrets. Prompts are written separately.
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const reader = createInterface({ input: process.stdin, output: silent, terminal: true, historySize: 0 });
  const ask = (prompt) => new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    const cancel = () => { cleanup(); reject(new AdminInitializationError("Initialization cancelled.")); };
    const cleanup = () => { reader.off("SIGINT", cancel); reader.off("close", cancel); };
    reader.once("SIGINT", cancel);
    reader.once("close", cancel);
    reader.question("", (answer) => { cleanup(); process.stderr.write("\n"); resolve(answer); });
  });
  try {
    const password = await ask("Password (at least 10 characters, letters and digits): ");
    if (password !== await ask("Confirm password: ")) throw new AdminInitializationError("Passwords do not match.");
    return password;
  } finally { reader.close(); silent.end(); }
}

let sql;
try {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(help);
  else {
    const input = options(process.argv.slice(2));
    if (process.env.BUSINESS_TEMPLATE !== "personal-archive" || !process.env.DATABASE_URL) {
      throw new AdminInitializationError("Set BUSINESS_TEMPLATE=personal-archive and DATABASE_URL for the intended instance.");
    }
    if (process.env.PASSWORD !== undefined) throw new AdminInitializationError("Remove PASSWORD from the environment; use the hidden prompt or --password-stdin.");
    const migrations = await readMigrations("migrations");
    const password = input.stdin ? await readPasswordFromPipe() : await promptPassword();
    const ssl = (process.env.DATABASE_SSL ?? "require").toLowerCase();
    sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, ssl: ["false", "disable"].includes(ssl) ? false : "require", onnotice: () => {} });
    await initializeAdmin(sql, { ...input, password }, migrations);
    console.log("First administrator created. You can now sign in with the email and password you supplied.");
  }
} catch (error) {
  console.error(error instanceof AdminInitializationError ? error.message : "Initialization failed. Check database access and run this release's migrations first. No partial account was created.");
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 5 }); }
