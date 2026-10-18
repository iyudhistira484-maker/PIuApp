import { z } from "zod";
import { HttpError, wrap, uuid } from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
import { platformResult, schemaMissing } from "../lib/platform.mjs";

/**
 * The bell reads server-stored rows, so every signed-in device sees the same
 * list. Browser writes are limited to marking a row read; creating rows is a
 * service-role concern (payments, admin credit changes, invites).
 */
export function registerNotifications(app, ctx) {
  app.get(
    "/api/notifications",
    ctx.auth,
    rateLimit({ max: 90 }),
    wrap(async (req, res) => {
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .parse(req.query.limit || 20);
      let result;
      try {
        result = await ctx
          .needAdmin()
          .rpc("piwu_notifications", { p_user: req.user.id, p_limit: limit });
      } catch {
        throw new HttpError(
          503,
          "Notifikasi belum dapat dimuat. Coba lagi.",
          "NOTIFY_UNAVAILABLE",
        );
      }
      if (result.error && schemaMissing(result.error))
        return res.json({
          applied: false,
          items: [],
          unread: 0,
          notice:
            "Notifikasi server belum diterapkan. Jalankan migration 012_notifications.sql.",
        });
      const data = platformResult(result);
      res.json({
        applied: true,
        items: Array.isArray(data.items) ? data.items : [],
        unread: Number(data.unread) || 0,
      });
    }),
  );
  app.post(
    "/api/notifications/:id/read",
    ctx.auth,
    rateLimit({ max: 120 }),
    wrap(async (req, res) => {
      const id = uuid(req.params.id);
      if (!id) throw new HttpError(400, "ID notifikasi tidak valid.");
      const result = await ctx
        .needAdmin()
        .rpc("piwu_notification_read", { p_user: req.user.id, p_id: id });
      if (result.error && schemaMissing(result.error))
        throw new HttpError(503, "Notifikasi server belum tersedia.");
      if (result.error?.message?.includes("NOTIFY_NOT_FOUND"))
        throw new HttpError(404, "Notifikasi tidak ditemukan.");
      platformResult(result);
      res.json({ read: true });
    }),
  );
  app.post(
    "/api/notifications/read-all",
    ctx.auth,
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const result = await ctx
        .needAdmin()
        .rpc("piwu_notification_read_all", { p_user: req.user.id });
      if (result.error && schemaMissing(result.error))
        throw new HttpError(503, "Notifikasi server belum tersedia.");
      platformResult(result);
      res.json({ read: Number(result.data) || 0 });
    }),
  );
}
