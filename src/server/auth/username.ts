export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validUsername(value: string): boolean {
  return /^[a-z][a-z0-9._-]{2,31}$/.test(value);
}

// The inherited schema still requires a unique email for each user. This
// reserved internal value is never requested from or shown to the operator.
export function internalAccountEmail(username: string): string {
  return `${username}@accounts.invalid`;
}
