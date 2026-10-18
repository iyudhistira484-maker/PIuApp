import { z } from "zod";
import {
  check,
  wrap,
  validFiles,
  assertNoSecrets,
  token,
  hash,
  appOrigin,
  HttpError,
} from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
const eventSchema = z.object({
  time: z.number().nonnegative(),
  label: z.string().max(300),
  files: z.record(z.string(), z.string()),
  message: z.string().max(12000).optional(),
});
export function registerRecordings(app, ctx) {
  app.post(
    "/api/projects/:id/recordings",
    ctx.auth,
    ctx.project("Owner"),
    rateLimit({ max: 5 }),
    wrap(async (req, res) => {
      const body = z
        .object({
          title: z.string().trim().min(1).max(100),
          events: z.array(eventSchema).min(1).max(100),
          confirmPublic: z.literal(true),
        })
        .parse(req.body);
      if (JSON.stringify(body).length > 4000000)
        throw new HttpError(413, "Rekaman maksimal 4 MB.");
      for (const e of body.events) validFiles(e.files);
      assertNoSecrets(body.events);
      const saved = check(
        await ctx.admin
          .from("session_recordings")
          .insert({
            project_id: req.project.id,
            title: body.title,
            events: body.events,
          })
          .select("id,title,created_at")
          .single(),
      );
      const raw = token();
      check(
        await ctx.admin.from("recording_shares").insert({
          recording_id: saved.id,
          created_by: req.user.id,
          token_hash: hash(raw),
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        }),
      );
      res.json({
        recording: saved,
        url: appOrigin(ctx.env) + "/recording/" + raw,
        expiresDays: 7,
      });
    }),
  );
  app.get(
    "/api/public/recordings/:token",
    rateLimit({ max: 30 }),
    wrap(async (req, res) => {
      if (!/^[a-f0-9]{64}$/.test(req.params.token))
        throw new HttpError(404, "Rekaman tidak tersedia.");
      const share = check(
        await ctx
          .needAdmin()
          .from("recording_shares")
          .select("recording_id,expires_at,revoked_at")
          .eq("token_hash", hash(req.params.token))
          .maybeSingle(),
      );
      if (
        !share ||
        share.revoked_at ||
        Date.parse(share.expires_at) < Date.now()
      )
        throw new HttpError(410, "Tautan rekaman kedaluwarsa atau dicabut.");
      const row = check(
        await ctx.admin
          .from("session_recordings")
          .select("title,events,created_at")
          .eq("id", share.recording_id)
          .single(),
      );
      res.set("Cache-Control", "no-store").json({ recording: row });
    }),
  );
  app.get(
    "/api/projects/:id/recordings",
    ctx.auth,
    ctx.project(),
    wrap(async (req, res) =>
      res.json({
        recordings: check(
          await ctx.admin
            .from("session_recordings")
            .select("id,title,created_at")
            .eq("project_id", req.project.id)
            .order("created_at", { ascending: false })
            .limit(20),
        ),
      }),
    ),
  );
  app.delete(
    "/api/projects/:id/recordings/:recordingId/share",
    ctx.auth,
    ctx.project("Owner"),
    wrap(async (req, res) => {
      const row = check(
        await ctx.admin
          .from("session_recordings")
          .select("id")
          .eq("id", req.params.recordingId)
          .eq("project_id", req.project.id)
          .single(),
      );
      check(
        await ctx.admin
          .from("recording_shares")
          .update({ revoked_at: new Date().toISOString() })
          .eq("recording_id", row.id),
      );
      res.json({ revoked: true });
    }),
  );
}
