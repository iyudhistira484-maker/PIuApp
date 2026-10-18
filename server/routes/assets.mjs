import { z } from "zod";
import { randomUUID } from "node:crypto";
import { HttpError, wrap, check, seal, assertNoSecrets } from "../lib/core.mjs";
import { inspectAttachment } from "../lib/attachments.mjs";
import { rateLimit } from "../lib/context.mjs";
export function registerAssets(app, ctx) {
  app.get(
    "/api/projects/:id/secrets",
    ctx.auth,
    ctx.project("Owner"),
    wrap(async (req, res) =>
      res.json({
        secrets: check(
          await ctx.admin
            .from("env_vars")
            .select("id,key,environment")
            .eq("project_id", req.project.id),
        ),
      }),
    ),
  );
  app.post(
    "/api/projects/:id/secrets",
    ctx.auth,
    ctx.project("Owner"),
    wrap(async (req, res) => {
      const data = z
        .object({
          key: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
          value: z.string().min(1).max(10000),
          environment: z.enum(["dev", "production"]),
        })
        .parse(req.body);
      if (/^(VITE_|NEXT_PUBLIC_|PUBLIC_)/.test(data.key))
        throw new HttpError(
          400,
          "Secret tidak boleh memakai prefix yang diekspos ke frontend.",
        );
      const ciphertext = seal(
        data.value,
        ctx.env.SECRETS_ENCRYPTION_KEY,
        `${req.project.id}:${data.environment}:${data.key}`,
      );
      check(
        await ctx.admin.from("env_vars").upsert(
          {
            project_id: req.project.id,
            key: data.key,
            environment: data.environment,
            encrypted_value: "\\x" + ciphertext,
          },
          { onConflict: "project_id,key,environment" },
        ),
      );
      res.json({ saved: true, key: data.key, environment: data.environment });
    }),
  );
  app.delete(
    "/api/projects/:id/secrets/:secretId",
    ctx.auth,
    ctx.project("Owner"),
    wrap(async (req, res) => {
      check(
        await ctx.admin
          .from("env_vars")
          .delete()
          .eq("id", req.params.secretId)
          .eq("project_id", req.project.id),
      );
      res.json({ deleted: true });
    }),
  );
  app.get(
    "/api/projects/:id/assets",
    ctx.auth,
    ctx.project(),
    wrap(async (req, res) => {
      const assets = check(
        await ctx.admin
          .from("asset_records")
          .select("id,path,mime,size_bytes,created_at")
          .eq("project_id", req.project.id)
          .order("created_at", { ascending: false }),
      );
      const result = await Promise.all(
        assets.map(async (asset) => {
          const signed = await ctx.admin.storage
            .from("project-assets")
            .createSignedUrl(asset.path, 300);
          return { ...asset, url: signed.data?.signedUrl || null };
        }),
      );
      res.json({ assets: result });
    }),
  );
  app.post(
    "/api/projects/:id/assets",
    ctx.auth,
    ctx.project("Editor"),
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const bytes = inspectAttachment(req.body);
      if (req.body.mime === "text/plain")
        assertNoSecrets(bytes.toString("utf8"));
      const name = req.body.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
      const path = req.project.id + "/" + randomUUID() + "-" + name;
      check(
        await ctx.admin.storage
          .from("project-assets")
          .upload(path, bytes, { contentType: req.body.mime, upsert: false }),
      );
      try {
        const asset = check(
          await ctx.admin
            .from("asset_records")
            .insert({
              project_id: req.project.id,
              path,
              mime: req.body.mime,
              size_bytes: bytes.length,
              created_by: req.user.id,
            })
            .select("id,path,mime,size_bytes")
            .single(),
        );
        res.status(201).json({ asset });
      } catch (e) {
        await ctx.admin.storage.from("project-assets").remove([path]);
        throw e;
      }
    }),
  );
  app.delete(
    "/api/projects/:id/assets/:assetId",
    ctx.auth,
    ctx.project("Editor"),
    wrap(async (req, res) => {
      const asset = check(
        await ctx.admin
          .from("asset_records")
          .select("path")
          .eq("id", req.params.assetId)
          .eq("project_id", req.project.id)
          .single(),
      );
      check(
        await ctx.admin.storage.from("project-assets").remove([asset.path]),
      );
      check(
        await ctx.admin
          .from("asset_records")
          .delete()
          .eq("id", req.params.assetId)
          .eq("project_id", req.project.id),
      );
      res.json({ deleted: true });
    }),
  );
}
