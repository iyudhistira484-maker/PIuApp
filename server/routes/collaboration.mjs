import { z } from "zod";
import {
  HttpError,
  check,
  wrap,
  hash,
  token,
  appOrigin,
  html,
  uuid,
} from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
import { notifyUser } from "../lib/notifications.mjs";
export function registerCollaboration(app, ctx) {
  app.get(
    "/api/projects/:id/members",
    ctx.auth,
    ctx.project(),
    wrap(async (req, res) => {
      const members = check(
        await ctx.admin
          .from("collaborators")
          .select("user_id,role")
          .eq("project_id", req.project.id),
      );
      const all = [
        { user_id: req.project.owner_id, role: "Owner" },
        ...members,
      ];
      const users = await Promise.all(
        all.map(async (m) => {
          const { data } = await ctx.admin.auth.admin.getUserById(m.user_id);
          return {
            id: m.user_id,
            role: m.role,
            name:
              typeof data.user?.user_metadata?.name === "string"
                ? data.user.user_metadata.name
                : data.user?.email?.split("@")[0] || "Anggota",
          };
        }),
      );
      res.json({
        members: users,
        invites:
          req.projectRole === "Owner"
            ? check(
                await ctx.admin
                  .from("project_invites")
                  .select("id,email,role,expires_at,accepted_at,revoked_at")
                  .eq("project_id", req.project.id)
                  .order("created_at", { ascending: false })
                  .limit(30),
              )
            : [],
      });
    }),
  );
  app.post(
    "/api/projects/:id/invites",
    ctx.auth,
    ctx.project("Owner"),
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const body = z
        .object({
          email: z.union([z.email(), z.literal("")]).optional(),
          role: z.enum(["Viewer", "Editor"]),
        })
        .parse(req.body);
      const raw = token(),
        link = appOrigin(ctx.env) + "/invite/" + raw;
      const invite = check(
        await ctx.admin
          .from("project_invites")
          .insert({
            project_id: req.project.id,
            created_by: req.user.id,
            email: body.email?.toLowerCase() || null,
            role: body.role,
            token_hash: hash(raw),
            expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
          })
          .select("id,email,role,expires_at")
          .single(),
      );
      let emailSent = false;
      if (body.email && ctx.env.RESEND_API_KEY && ctx.env.EMAIL_FROM) {
        const result = await ctx
          .fetcher("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + ctx.env.RESEND_API_KEY,
              "Content-Type": "application/json",
              "Idempotency-Key": "invite-" + invite.id,
            },
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              from: ctx.env.EMAIL_FROM,
              to: [body.email],
              subject: "Undangan project PiwuApp",
              html: `<h2>Bangun bersama di PiwuApp</h2><p>Anda diundang ke <strong>${html(req.project.name)}</strong> sebagai ${body.role}.</p><p><a href="${html(link)}">Tinjau undangan</a></p><p>Tautan berlaku 7 hari. Abaikan jika Anda tidak mengharapkannya.</p>`,
            }),
          })
          .catch(() => null);
        emailSent = Boolean(result?.ok);
      }
      res.status(201).json({
        invite,
        link,
        emailSent,
        notice:
          body.email && !emailSent
            ? "Undangan dibuat. Email belum terkirim; bagikan tautan secara manual."
            : undefined,
      });
    }),
  );
  app.delete(
    "/api/projects/:id/invites/:inviteId",
    ctx.auth,
    ctx.project("Owner"),
    wrap(async (req, res) => {
      if (!uuid(req.params.inviteId))
        throw new HttpError(400, "ID undangan tidak valid.");
      check(
        await ctx.admin
          .from("project_invites")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", req.params.inviteId)
          .eq("project_id", req.project.id),
      );
      res.json({ revoked: true });
    }),
  );
  app.patch(
    "/api/projects/:id/members/:userId",
    ctx.auth,
    ctx.project("Owner"),
    wrap(async (req, res) => {
      const role = z.enum(["Viewer", "Editor", "remove"]).parse(req.body.role);
      if (
        !uuid(req.params.userId) ||
        req.params.userId === req.project.owner_id
      )
        throw new HttpError(
          400,
          "Pemilik tidak dapat diubah melalui menu anggota.",
        );
      const q =
        role === "remove"
          ? ctx.admin.from("collaborators").delete()
          : ctx.admin.from("collaborators").update({ role });
      check(
        await q
          .eq("project_id", req.project.id)
          .eq("user_id", req.params.userId),
      );
      res.json({ updated: true });
    }),
  );
  app.get(
    "/api/invites/:token",
    ctx.auth,
    wrap(async (req, res) => {
      if (!/^[a-f0-9]{64}$/.test(req.params.token))
        throw new HttpError(404, "Undangan tidak ditemukan.");
      const inv = check(
        await ctx
          .needAdmin()
          .from("project_invites")
          .select("project_id,role,email,expires_at,accepted_by,revoked_at")
          .eq("token_hash", hash(req.params.token))
          .maybeSingle(),
      );
      if (!inv || inv.revoked_at || Date.parse(inv.expires_at) < Date.now())
        throw new HttpError(410, "Undangan kedaluwarsa atau dicabut.");
      if (
        inv.email &&
        (!req.user.email_confirmed_at ||
          inv.email !== req.user.email?.toLowerCase())
      )
        throw new HttpError(
          403,
          "Gunakan akun dengan alamat email penerima undangan.",
        );
      if (inv.accepted_by && inv.accepted_by !== req.user.id)
        throw new HttpError(410, "Undangan sudah digunakan.");
      const p = check(
        await ctx.admin
          .from("projects")
          .select("name")
          .eq("id", inv.project_id)
          .single(),
      );
      res.json({
        name: p.name,
        role: inv.role,
        expiresAt: inv.expires_at,
        accepted: Boolean(inv.accepted_by),
      });
    }),
  );
  app.post(
    "/api/invites/:token/accept",
    ctx.auth,
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      if (!/^[a-f0-9]{64}$/.test(req.params.token))
        throw new HttpError(404, "Undangan tidak ditemukan.");
      if (!req.user.email_confirmed_at && !req.user.phone_confirmed_at)
        throw new HttpError(
          403,
          "Konfirmasikan email atau nomor HP Anda terlebih dahulu.",
        );
      const id = check(
        await ctx.needAdmin().rpc("piwu_accept_invite", {
          p_hash: hash(req.params.token),
          p_user: req.user.id,
          p_email: req.user.email_confirmed_at ? req.user.email || "" : "",
        }),
      );
      const project = await ctx
        .needAdmin()
        .from("projects")
        .select("name,owner_id")
        .eq("id", id)
        .maybeSingle();
      if (project.data && project.data.owner_id !== req.user.id) {
        const member = await ctx.admin
          .from("collaborators")
          .select("role")
          .eq("project_id", id)
          .eq("user_id", req.user.id)
          .maybeSingle();
        const name =
          req.user.user_metadata?.name || req.user.email || "Seseorang";
        await notifyUser(ctx, project.data.owner_id, {
          kind: "project",
          title: "Anggota baru bergabung",
          body:
            name +
            ' bergabung ke "' +
            project.data.name +
            '" sebagai ' +
            (member.data?.role || "kolaborator") +
            ".",
          href: "/project/" + id,
          dedupe: "invite:" + id + ":" + req.user.id,
        });
      }
      res.json({ projectId: id });
    }),
  );
  app.get(
    "/api/projects/:id/comments",
    ctx.auth,
    ctx.project(),
    wrap(async (req, res) =>
      res.json({
        comments: check(
          await ctx.admin
            .from("comments")
            .select("id,element_selector,body,status,author_id,created_at")
            .eq("project_id", req.project.id)
            .order("created_at", { ascending: true })
            .limit(300),
        ),
      }),
    ),
  );
  app.post(
    "/api/projects/:id/comments",
    ctx.auth,
    ctx.project(),
    rateLimit({ max: 20 }),
    wrap(async (req, res) => {
      const data = z
        .object({
          body: z.string().trim().min(1).max(4000),
          selector: z.string().max(500),
        })
        .parse(req.body);
      const comment = check(
        await ctx.admin
          .from("comments")
          .insert({
            project_id: req.project.id,
            author_id: req.user.id,
            body: data.body,
            element_selector: data.selector,
            status: "open",
          })
          .select()
          .single(),
      );
      res.status(201).json({ comment });
    }),
  );
  app.patch(
    "/api/projects/:id/comments/:commentId",
    ctx.auth,
    ctx.project(),
    wrap(async (req, res) => {
      const status = z.enum(["open", "resolved"]).parse(req.body.status);
      const comment = check(
        await ctx.admin
          .from("comments")
          .select("author_id")
          .eq("id", req.params.commentId)
          .eq("project_id", req.project.id)
          .maybeSingle(),
      );
      if (!comment) throw new HttpError(404, "Komentar tidak tersedia.");
      if (req.projectRole === "Viewer" && comment.author_id !== req.user.id)
        throw new HttpError(
          403,
          "Anda hanya dapat menyelesaikan komentar sendiri.",
        );
      check(
        await ctx.admin
          .from("comments")
          .update({ status })
          .eq("id", req.params.commentId)
          .eq("project_id", req.project.id),
      );
      res.json({ updated: true });
    }),
  );
}
