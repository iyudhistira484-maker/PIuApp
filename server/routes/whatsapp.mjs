import express from "express";
import { Webhook } from "standardwebhooks";
import { HttpError, wrap, hash, check } from "../lib/core.mjs";
export function registerWhatsApp(app, ctx) {
  app.post(
    "/api/webhooks/whatsapp",
    express.raw({ type: "application/json", limit: "32kb" }),
    wrap(async (req, res) => {
      const e = ctx.env;
      if (
        !e.SUPABASE_SMS_HOOK_SECRET ||
        !e.WHATSAPP_TOKEN ||
        !e.WHATSAPP_PHONE_ID ||
        !e.WHATSAPP_TEMPLATE
      )
        throw new HttpError(503, "WhatsApp delivery belum dikonfigurasi.");
      let payload;
      const raw = req.body.toString("utf8");
      try {
        const key = e.SUPABASE_SMS_HOOK_SECRET.replace(
          /^v1,whsec_/,
          "",
        ).replace(/^whsec_/, "");
        payload = new Webhook(key).verify(raw, {
          "webhook-id": req.get("webhook-id"),
          "webhook-timestamp": req.get("webhook-timestamp"),
          "webhook-signature": req.get("webhook-signature"),
        });
      } catch {
        throw new HttpError(
          401,
          "Signature hook tidak valid atau kedaluwarsa.",
        );
      }
      const phone = payload.user?.phone,
        otp = payload.sms?.otp;
      if (
        typeof phone !== "string" ||
        !/^\+?[1-9][0-9]{7,14}$/.test(phone) ||
        typeof otp !== "string" ||
        !/^\d{4,8}$/.test(otp)
      )
        throw new HttpError(400, "Payload OTP tidak valid.");
      const id = req.get("webhook-id"),
        bodyHash = hash(raw);
      const db = ctx.needAdmin();
      let claimed = await db.from("webhook_receipts").insert({
        provider: "whatsapp",
        event_id: id,
        body_hash: bodyHash,
        status: "processing",
      });
      if (claimed.error?.code === "23505") {
        const previous = check(
          await db
            .from("webhook_receipts")
            .select("status,body_hash,attempts")
            .eq("provider", "whatsapp")
            .eq("event_id", id)
            .single(),
        );
        if (previous.body_hash !== bodyHash)
          throw new HttpError(
            409,
            "Identitas hook digunakan ulang untuk payload berbeda.",
          );
        if (previous.status === "done") return res.json({});
        if (previous.status !== "failed" || previous.attempts >= 3)
          throw new HttpError(
            409,
            "Pengiriman sedang diproses atau perlu ditinjau.",
          );
        const retry = check(
          await db
            .from("webhook_receipts")
            .update({
              status: "processing",
              attempts: previous.attempts + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("provider", "whatsapp")
            .eq("event_id", id)
            .eq("status", "failed")
            .select("event_id"),
        );
        if (!retry.length)
          throw new HttpError(409, "Pengiriman sedang diproses.");
      } else check(claimed);
      try {
        if (
          !/^\d+$/.test(e.WHATSAPP_PHONE_ID) ||
          !/^v\d+\.\d+$/.test(e.WHATSAPP_GRAPH_VERSION || "v22.0")
        )
          throw new HttpError(503, "Konfigurasi WhatsApp tidak valid.");
        const r = await ctx.fetcher(
          `https://graph.facebook.com/${e.WHATSAPP_GRAPH_VERSION || "v22.0"}/${e.WHATSAPP_PHONE_ID}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + e.WHATSAPP_TOKEN,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phone.replace(/^\+/, ""),
              type: "template",
              template: {
                name: e.WHATSAPP_TEMPLATE,
                language: { code: e.WHATSAPP_LANGUAGE || "id" },
                components: [
                  { type: "body", parameters: [{ type: "text", text: otp }] },
                  {
                    type: "button",
                    sub_type: "url",
                    index: "0",
                    parameters: [{ type: "text", text: otp }],
                  },
                ],
              },
            }),
          },
        );
        if (!r.ok)
          throw new HttpError(
            502,
            "Provider WhatsApp menolak pengiriman. Periksa template Authentication yang disetujui.",
          );
        check(
          await db
            .from("webhook_receipts")
            .update({ status: "done", updated_at: new Date().toISOString() })
            .eq("provider", "whatsapp")
            .eq("event_id", id),
        );
        res.json({});
      } catch (error) {
        await db
          .from("webhook_receipts")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("provider", "whatsapp")
          .eq("event_id", id);
        throw error;
      }
    }),
  );
}
