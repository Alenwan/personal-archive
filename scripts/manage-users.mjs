import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import postgres from "postgres";
import { hashPassword, validateNewPassword } from "../src/server/auth/password.ts";

const help = `Manage accounts on an installed Personal Archive instance.
  node dist-server/manage-users.mjs list
  node dist-server/manage-users.mjs create --email person@example.org --name "Person" [--role Staff]
  node dist-server/manage-users.mjs reset-password --email person@example.org
Roles: Admin, Manager, Staff, ReadOnly. New accounts use Staff unless --role is set.
Passwords are entered twice at a hidden terminal prompt. For protected automation,
append --password-stdin and pipe exactly one password line. No password arguments or
default accounts are supported.`;

function parse(args) {
  const command = args.shift();
  if (!["list", "create", "reset-password", "has-users"].includes(command)) throw new Error(help);
  const options = { email: "", name: "", role: "Staff", stdin: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error("Duplicate option. Use --help.");
    seen.add(flag);
    if (flag === "--password-stdin") options.stdin = true;
    else if (["--email", "--name", "--role"].includes(flag) && args[i + 1] && !args[i + 1].startsWith("--")) options[flag.slice(2)] = args[++i];
    else throw new Error("Unknown or incomplete option. Use --help.");
  }
  if (["list", "has-users"].includes(command) && seen.size) throw new Error("This command takes no options.");
  if (command === "reset-password" && (seen.has("--name") || seen.has("--role"))) throw new Error("reset-password only accepts --email.");
  if (["create", "reset-password"].includes(command) && !options.email) throw new Error("--email is required.");
  if (command === "create" && !options.name) throw new Error("--name is required.");
  if (command === "create" && !["Admin", "Manager", "Staff", "ReadOnly"].includes(options.role)) throw new Error("Invalid role.");
  options.email = options.email.trim().toLowerCase();
  options.name = options.name.trim();
  if (options.email && (options.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email) || options.email === "system@md3-platform.local")) {
    throw new Error("Provide a valid, non-system email address.");
  }
  if (command === "create" && (!options.name || options.name.length > 100 || /[\u0000-\u001f\u007f]/.test(options.name))) throw new Error("Provide a name of 1–100 characters.");
  return { command, ...options };
}

async function passwordFromPipe() {
  if (process.stdin.isTTY) throw new Error("--password-stdin requires a pipe.");
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    value += chunk;
    if (Buffer.byteLength(value) > 4096) throw new Error("Password input is too long.");
  }
  value = value.replace(/\r?\n$/, "");
  if (!value || /[\r\n]/.test(value)) throw new Error("Supply exactly one password line.");
  return value;
}

async function passwordFromTerminal() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error("Use an interactive terminal or --password-stdin.");
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const reader = createInterface({ input: process.stdin, output: silent, terminal: true, historySize: 0 });
  const ask = (label) => new Promise((resolve, reject) => {
    process.stderr.write(label);
    const cancel = () => { cleanup(); reject(new Error("Cancelled.")); };
    const cleanup = () => { reader.off("SIGINT", cancel); reader.off("close", cancel); };
    reader.once("SIGINT", cancel);
    reader.once("close", cancel);
    reader.question("", (answer) => { cleanup(); process.stderr.write("\n"); resolve(answer); });
  });
  try {
    const password = await ask("Password (at least 10 characters, letters and digits): ");
    if (password !== await ask("Confirm password: ")) throw new Error("Passwords do not match.");
    return password;
  } finally { reader.close(); silent.end(); }
}

let sql;
try {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(help);
  else {
    if (process.env.BUSINESS_TEMPLATE !== "personal-archive" || !process.env.DATABASE_URL) throw new Error("Run this command inside the intended Personal Archive app service.");
    if (process.env.PASSWORD !== undefined) throw new Error("Remove PASSWORD from the environment.");
    const input = parse(process.argv.slice(2));
    const needsPassword = ["create", "reset-password"].includes(input.command);
    const password = needsPassword ? (input.stdin ? await passwordFromPipe() : await passwordFromTerminal()) : null;
    if (password) {
      if (password.length > 1024 || /[\r\n\u0000]/.test(password)) throw new Error("Invalid password input.");
      const invalid = validateNewPassword(password);
      if (invalid) throw new Error(invalid);
    }
    const ssl = (process.env.DATABASE_SSL ?? "require").toLowerCase();
    sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, ssl: ["false", "disable"].includes(ssl) ? false : "require", onnotice: () => {} });
    if (input.command === "has-users") {
      const [row] = await sql`select exists(select 1 from users where email <> 'system@md3-platform.local') as populated`;
      process.exitCode = row.populated ? 0 : 3;
    } else if (input.command === "list") {
      const rows = await sql`select name, email, role from users where email <> 'system@md3-platform.local' order by created_at, user_id`;
      for (const row of rows) console.log(`${row.email}\t${row.role}\t${row.name}`);
      if (!rows.length) console.log("No login accounts. Run the first-administrator installer.");
    } else {
      const credential = await hashPassword(password);
      await sql.begin(async (tx) => {
        await tx`set local lock_timeout = '5s'`;
        await tx`lock table users, user_credentials in share row exclusive mode`;
        const [admin] = await tx`select user_id from users where role = 'Admin' and email <> 'system@md3-platform.local' order by created_at limit 1`;
        if (!admin) throw new Error("Initialize the first administrator before managing users.");
        const [existing] = await tx`select user_id from users where lower(email) = ${input.email} limit 1`;
        let userId = existing?.user_id;
        if (input.command === "create") {
          if (userId) throw new Error("That email already has an account. Use reset-password instead.");
          const [created] = await tx`insert into users (name, email, role) values (${input.name}, ${input.email}, ${input.role}) returning user_id`;
          userId = created.user_id;
        } else if (!userId) throw new Error("No account found for that email.");
        await tx`insert into user_credentials (
          user_id, password_hash, password_salt, password_algorithm, password_iterations,
          must_change_password, password_changed_at, temporary_password_issued_at,
          failed_login_count, locked_until, updated_at
        ) values (
          ${userId}, ${credential.passwordHash}, ${credential.passwordSalt},
          ${credential.passwordAlgorithm}, ${credential.passwordIterations},
          true, null, now(), 0, null, now()
        ) on conflict (user_id) do update set
          password_hash = excluded.password_hash,
          password_salt = excluded.password_salt,
          password_algorithm = excluded.password_algorithm,
          password_iterations = excluded.password_iterations,
          must_change_password = true,
          password_changed_at = null,
          temporary_password_issued_at = now(),
          failed_login_count = 0,
          locked_until = null,
          updated_at = now()`;
        if (input.command === "reset-password") await tx`update auth_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
        await tx`insert into audit_logs (action, entity_type, entity_id, user_id, metadata)
          values (${input.command === "create" ? "CreateUser" : "ResetUserPassword"}, 'User', ${userId},
            '90000000-0000-4000-8000-000000000099'::uuid, '{"source":"server-cli"}'::jsonb)`;
      });
      console.log(input.command === "create"
        ? "Account created. Give the temporary password privately; the user must change it at first sign-in."
        : "Password reset and active sessions revoked. The user must change the temporary password at next sign-in.");
    }
  }
} catch (error) {
  console.error(error?.message ?? "User management failed.");
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 5 }); }
