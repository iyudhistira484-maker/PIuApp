import { schemaMissing } from "./platform.mjs";

/** The kinds the database accepts (migration 012). */
export const NOTIFICATION_KINDS = [
  "payment",
  "credits",
  "project",
  "marketplace",
  "system",
];

/**
 * Best-effort notification write. A missing migration, a deleted account or a
 * provider outage must never fail the business action that triggered it; the
 * caller can ignore the null result. Dedupe keys make retries harmless.
 */
export async function notifyUser(
  ctx,
  userId,
  { kind, title, body, href = "", dedupe = null },
) {
  if (!ctx?.admin || !userId) return null;
  try {
    const result = await ctx.admin.rpc("piwu_notification_add", {
      p_user: userId,
      p_kind: kind,
      p_title: title,
      p_body: body,
      p_href: href,
      p_dedupe: dedupe,
    });
    if (result.error) {
      if (schemaMissing(result.error) || result.error.code === "23503")
        return null;
      return null;
    }
    return result.data || null;
  } catch {
    return null;
  }
}
