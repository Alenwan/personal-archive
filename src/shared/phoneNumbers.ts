export interface NormalizedPhoneNumber {
  raw: string;
  digits: string;
  display: string;
  matchKeys: string[];
  isLikelyPhoneNumber: boolean;
  isLikelyExtension: boolean;
}

export function phoneDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatReadablePhone(value: string | null | undefined): string {
  const digits = phoneDigits(value);
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return String(value ?? "").trim() || digits;
}

export function normalizePhoneNumber(value: string | null | undefined): NormalizedPhoneNumber {
  const raw = String(value ?? "").trim();
  const digits = phoneDigits(raw);
  const keys = new Set<string>();
  if (digits) keys.add(digits);
  if (digits.length === 11 && digits.startsWith("1")) keys.add(digits.slice(1));
  if (digits.length === 10) keys.add(`1${digits}`);

  return {
    raw,
    digits,
    display: formatReadablePhone(raw || digits),
    matchKeys: [...keys],
    isLikelyPhoneNumber: digits.length >= 10,
    isLikelyExtension: digits.length >= 2 && digits.length <= 6
  };
}

export function phoneNumbersMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftPhone = normalizePhoneNumber(left);
  const rightKeys = new Set(normalizePhoneNumber(right).matchKeys);
  return leftPhone.matchKeys.some((key) => rightKeys.has(key));
}

export function extensionMatches(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftDigits = phoneDigits(left);
  const rightDigits = phoneDigits(right);
  if (!leftDigits || !rightDigits) return false;
  if (leftDigits.length > 6 || rightDigits.length > 6) return false;
  return leftDigits === rightDigits;
}
