/**
 * Profile edits, as pure functions.
 *
 * The account record itself lives in Supabase auth (`user_metadata.name`,
 * `email`), and this app never writes it from the server: the page calls
 * `supabase.auth.updateUser` with the verified session. These helpers decide
 * what is worth sending and refuse to claim success when nothing changed.
 */
export interface Identity {
  name?: string;
  email?: string;
  id?: string;
}

export const NAME_MAX = 60;

/** Trimmed display name, or the reason it cannot be used. */
export function validateName(raw: string) {
  const value = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length < 2)
    return { value, error: "Nama tampilan minimal 2 karakter." } as const;
  if (value.length > NAME_MAX)
    return {
      value,
      error: `Nama tampilan maksimal ${NAME_MAX} karakter.`,
    } as const;
  return { value, error: "" } as const;
}

/** Local check only; the auth service's own policy still has the final word. */
export const PASSWORD_MIN = 8;

export function validatePassword(password: string, confirm: string) {
  if (password.length < PASSWORD_MIN)
    return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  if (password !== confirm) return "Konfirmasi kata sandi tidak cocok.";
  return "";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email change requests: the new address is only active after confirmation. */
export function validateEmail(raw: string, current = "") {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL_PATTERN.test(value)) return "Format email tidak valid.";
  if (current && value === current.trim().toLowerCase())
    return "Email itu sudah dipakai akun ini.";
  return "";
}

/**
 * Which identity fields really changed. Used to avoid a request that updates
 * nothing (and to avoid reporting a change that never left the browser).
 */
export function changedFields(current: Identity, next: Identity) {
  const out: { name?: string; email?: string } = {};
  const name = validateName(next.name ?? "");
  if (!name.error && name.value !== (current.name ?? "").trim())
    out.name = name.value;
  const email = String(next.email ?? "")
    .trim()
    .toLowerCase();
  if (
    email &&
    email !== (current.email ?? "").trim().toLowerCase() &&
    !validateEmail(email)
  )
    out.email = email;
  return out;
}

/** "c9d4b2e3-2222-…9777" — id shown only where a full id is unreadable. */
export function shortId(id?: string | null) {
  if (!id) return "";
  return id.length <= 16 ? id : id.slice(0, 8) + "…" + id.slice(-4);
}
