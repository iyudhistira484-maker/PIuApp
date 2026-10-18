import { z } from "zod";
import {
  HttpError,
  wrap,
  check,
  validFiles,
  assertNoSecrets,
  uuid,
} from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
export function registerMarketplace(app, ctx) {
  app.get(
    "/api/marketplace",
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const rows = check(
        await ctx
          .needAdmin()
          .from("templates")
          .select("id,title,description,category,price,preview_url,created_at")
          .eq("status", "published")
          .order("created_at", { ascending: false })
          .limit(100),
      );
      res.json({ templates: rows });
    }),
  );
  app.get(
    "/api/marketplace/mine",
    ctx.auth,
    wrap(async (req, res) =>
      res.json({
        templates: check(
          await ctx
            .needAdmin()
            .from("templates")
            .select(
              "id,title,description,category,price,status,preview_url,created_at",
            )
            .eq("owner_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(100),
        ),
      }),
    ),
  );
  app.get(
    "/api/marketplace/purchased",
    ctx.auth,
    wrap(async (req, res) => {
      const access = check(
        await ctx
          .needAdmin()
          .from("template_entitlements")
          .select("template_id")
          .eq("user_id", req.user.id),
      );
      const templates = access.length
        ? check(
            await ctx.admin
              .from("templates")
              .select(
                "id,title,description,category,price,preview_url,created_at",
              )
              .in(
                "id",
                access.map((a) => a.template_id),
              ),
          )
        : [];
      res.json({ templates });
    }),
  );
  app.post(
    "/api/projects/:id/template",
    ctx.auth,
    ctx.project("Owner"),
    rateLimit({ max: 5 }),
    wrap(async (req, res) => {
      const fields = z
        .object({
          title: z.string().trim().min(3).max(80),
          description: z.string().trim().min(10).max(1000),
          category: z.string().max(50),
          price: z.number().int().min(0).max(10000000),
          confirmRights: z.literal(true),
        })
        .parse(req.body);
      const { payload } = await ctx.snapshot(req.project.id);
      validFiles(payload.files);
      const { confirmRights, ...metadata } = fields;
      const template = check(
        await ctx.admin
          .from("templates")
          .insert({
            ...metadata,
            owner_id: req.user.id,
            project_snapshot: {
              name: payload.name,
              template: payload.template,
              description: payload.description,
              files: payload.files,
            },
            price: fields.price,
            status: "published",
            preview_url: null,
          })
          .select("id,title,price,status")
          .single(),
      );
      res.status(201).json({
        template,
        notice:
          "Template dipublikasikan. Pendapatan bersih 80% dicatat setelah pembayaran terverifikasi; pencairan belum otomatis.",
      });
    }),
  );
  app.post(
    "/api/marketplace/:templateId/use",
    ctx.auth,
    wrap(async (req, res) => {
      if (!uuid(req.params.templateId))
        throw new HttpError(400, "ID template tidak valid.");
      const t = check(
        await ctx
          .needAdmin()
          .from("templates")
          .select("*")
          .eq("id", req.params.templateId)
          .maybeSingle(),
      );
      if (!t) throw new HttpError(404, "Template tidak tersedia.");
      if (
        (t.price > 0 || t.status !== "published") &&
        t.owner_id !== req.user.id
      ) {
        const access = check(
          await ctx.admin
            .from("template_entitlements")
            .select("template_id")
            .eq("template_id", t.id)
            .eq("user_id", req.user.id)
            .maybeSingle(),
        );
        if (!access) throw new HttpError(402, "Beli template terlebih dahulu.");
      }
      validFiles(t.project_snapshot.files);
      res.json({ snapshot: t.project_snapshot });
    }),
  );
  app.delete(
    "/api/marketplace/:templateId",
    ctx.auth,
    wrap(async (req, res) => {
      check(
        await ctx
          .needAdmin()
          .from("templates")
          .update({ status: "archived" })
          .eq("id", req.params.templateId)
          .eq("owner_id", req.user.id),
      );
      res.json({ archived: true });
    }),
  );
}
