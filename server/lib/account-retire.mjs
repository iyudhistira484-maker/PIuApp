import { HttpError } from "./core.mjs";

/** A tombstone on the reserved .invalid TLD: no mailbox, unique per account. */
export const tombstoneEmail = (id) => `deleted+${id}@piwu.invalid`;

const missing = (error) =>
  error?.status === 404 ||
  /not found|already.*deleted/i.test(error?.message || "");

/**
 * Retires the Supabase Auth identity after the database has removed the
 * account's personal rows. The Auth row itself cannot be deleted: invoices and
 * the admin audit trail reference it and must survive an account removal. It
 * is instead stripped of the real email (so the address can sign up again) and
 * soft-deleted (so it can never sign in).
 */
export async function retireIdentity(admin, id) {
  if (!admin) throw new HttpError(503, "Supabase server belum dikonfigurasi.");
  const updated = await admin.auth.admin.updateUserById(id, {
    email: tombstoneEmail(id),
    email_confirm: true,
    user_metadata: { name: "Akun dihapus" },
  });
  // A retry may find the soft-deleted user: there is nothing left to strip.
  if (updated.error && !missing(updated.error))
    throw new HttpError(
      502,
      "Data akun sudah dihapus dan aksesnya ditutup, tetapi email Auth belum dapat diganti. Ulangi permintaan yang sama untuk menyelesaikannya.",
      "ACCOUNT_EMAIL_FAILED",
    );
  const removed = await admin.auth.admin.deleteUser(id, true);
  if (removed.error && !missing(removed.error))
    throw new HttpError(
      502,
      "Data akun sudah dihapus dan email sudah diganti, tetapi identitas Auth belum dinonaktifkan. Ulangi permintaan yang sama untuk menyelesaikannya.",
      "ACCOUNT_AUTH_FAILED",
    );
}
