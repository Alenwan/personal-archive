import postgres from "postgres";
import { hashPassword, validateNewPassword } from "../src/server/auth/password.ts";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.USER_EMAIL;
const password = process.env.PASSWORD;
const mustChangePassword = (process.env.MUST_CHANGE_PASSWORD ?? "true").toLowerCase() !== "false";
const createIfMissing = (process.env.CREATE_IF_MISSING ?? "false").toLowerCase() === "true";
const userName = process.env.USER_NAME?.trim() || "Archive Owner";
const userRole = process.env.USER_ROLE?.trim() || "Admin";

if (!databaseUrl || !email || !password) {
  console.error("DATABASE_URL, USER_EMAIL, and PASSWORD are required.");
  process.exit(1);
}

const validationError = validateNewPassword(password);
if (validationError) {
  console.error(validationError);
  process.exit(1);
}

const databaseSsl = (process.env.DATABASE_SSL ?? "true").toLowerCase();
const sql = postgres(databaseUrl, {
  max: 1,
  ssl: databaseSsl === "false" || databaseSsl === "disable" ? false : "require"
});
let users = await sql`
  select user_id, email
  from users
  where lower(email) = lower(${email})
  limit 1
`;

if (!users[0] && createIfMissing) {
  if (!["Admin", "Manager", "Staff", "ReadOnly"].includes(userRole)) {
    await sql.end();
    console.error("USER_ROLE must be Admin, Manager, Staff, or ReadOnly.");
    process.exit(1);
  }
  await sql`
    insert into users (name, email, role)
    values (${userName}, ${email}, ${userRole})
    on conflict (email) do nothing
  `;
  users = await sql`
    select user_id, email
    from users
    where lower(email) = lower(${email})
    limit 1
  `;
}

if (!users[0]) {
  await sql.end();
  console.error(`No user found for ${email}. Set CREATE_IF_MISSING=true to create it.`);
  process.exit(1);
}

const credential = await hashPassword(password);
try {
  await sql.begin(async (transaction) => {
    const locked = await transaction`select user_id from users where user_id = ${users[0].user_id} for update`;
    if (!locked.length) throw new Error("Selected user no longer exists.");
    await transaction`
  insert into user_credentials (
    user_id,
    password_hash,
    password_salt,
    password_algorithm,
    password_iterations,
    must_change_password,
    password_changed_at,
    temporary_password_issued_at,
    failed_login_count,
    locked_until,
    updated_at
  )
  values (
    ${users[0].user_id},
    ${credential.passwordHash},
    ${credential.passwordSalt},
    ${credential.passwordAlgorithm},
    ${credential.passwordIterations},
    ${mustChangePassword},
    ${mustChangePassword ? null : new Date().toISOString()},
    ${mustChangePassword ? new Date().toISOString() : null},
    0,
    null,
    now()
  )
  on conflict (user_id) do update set
    password_hash = excluded.password_hash,
    password_salt = excluded.password_salt,
    password_algorithm = excluded.password_algorithm,
    password_iterations = excluded.password_iterations,
    must_change_password = excluded.must_change_password,
    password_changed_at = excluded.password_changed_at,
    temporary_password_issued_at = excluded.temporary_password_issued_at,
    failed_login_count = 0,
    locked_until = null,
    updated_at = now()
    `;
    await transaction`update auth_sessions set revoked_at = now() where user_id = ${users[0].user_id} and revoked_at is null`;
  });
} finally {
  await sql.end();
}
console.log(`Password credential updated for ${users[0].email}. must_change_password=${mustChangePassword}`);
