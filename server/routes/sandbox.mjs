import { z } from "zod";
import { randomUUID } from "node:crypto";
import { HttpError, wrap, check, capabilities } from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
import { CREDIT_COSTS } from "../../shared/credits.mjs";
export function registerSandbox(app, ctx, sandbox) {
  const endpoint = (path, operation) =>
    app.post(
      "/api/projects/:id/" + path,
      ctx.auth,
      ctx.project("Editor"),
      rateLimit({ max: 12 }),
      wrap(async (req, res) => {
        const snapshot = await ctx.snapshot(req.project.id);
        if (snapshot.payload.kind && snapshot.payload.kind !== "webapp")
          throw new HttpError(
            409,
            "Runtime ini khusus Web App. Gunakan Expo untuk aplikasi mobile atau Roblox Studio untuk Luau; file project tidak dikonversi menjadi Vite.",
          );
        const requestId = randomUUID();
        await ctx.reserve(
          req.user.id,
          requestId,
          path === "sandbox/command"
            ? CREDIT_COSTS.sandboxCommand
            : CREDIT_COSTS.sandboxJob,
          "sandbox",
        );
        let success = false;
        try {
          const data = await operation(req, snapshot.payload.files);
          await ctx.finish(requestId, true);
          success = true;
          res.json(data);
        } finally {
          if (!success) await ctx.finish(requestId, false).catch(() => {});
        }
      }),
    );
  endpoint("sandbox/command", (req, files) =>
    sandbox.run(
      req.user.id,
      req.project.id,
      files,
      z.string().trim().min(1).max(4000).parse(req.body.command),
    ),
  );
  endpoint("sandbox/preview", (req, files) =>
    sandbox.preview(req.user.id, req.project.id, files),
  );
  endpoint("packages", async (req, files) => {
    const body = z
      .object({
        spec: z.string().min(1).max(180),
        remove: z.boolean().optional(),
      })
      .parse(req.body);
    return sandbox.install(
      req.user.id,
      req.project.id,
      files,
      body.spec,
      body.remove,
    );
  });
  app.get(
    "/api/projects/:id/sandbox/files",
    ctx.auth,
    ctx.project("Editor"),
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const { payload } = await ctx.snapshot(req.project.id);
      if (payload.kind && payload.kind !== "webapp")
        throw new HttpError(
          409,
          "Snapshot sandbox web tidak dapat diimpor ke project Expo atau Roblox.",
        );
      res.json(await sandbox.snapshot(req.user.id, req.project.id));
    }),
  );
  app.delete(
    "/api/projects/:id/sandbox",
    ctx.auth,
    ctx.project("Editor"),
    wrap(async (req, res) => {
      await sandbox.stop(req.user.id, req.project.id);
      res.json({ stopped: true });
    }),
  );
  app.get(
    "/api/packages",
    ctx.auth,
    rateLimit({ max: 20 }),
    wrap(async (req, res) => {
      const query = z
        .string()
        .max(100)
        .parse(req.query.q || "react");
      const r = await ctx.fetcher(
        "https://registry.npmjs.org/-/v1/search?size=10&text=" +
          encodeURIComponent(query),
        { signal: AbortSignal.timeout(10000) },
      );
      if (!r.ok) throw new HttpError(502, "Registry npm tidak merespons.");
      const data = await r.json();
      res.json({
        packages: data.objects.map((o) => ({
          name: o.package.name,
          version: o.package.version,
          description: o.package.description,
        })),
      });
    }),
  );
  app.post(
    "/api/projects/:id/audit",
    ctx.auth,
    ctx.project("Editor"),
    rateLimit({ max: 3, windowMs: 600000 }),
    wrap(async (req, res) => {
      const { payload } = await ctx.snapshot(req.project.id);
      if (payload.kind && payload.kind !== "webapp")
        throw new HttpError(
          409,
          "Lighthouse hanya tersedia untuk project Web App.",
        );
      const run = randomUUID();
      await ctx.reserve(req.user.id, run, CREDIT_COSTS.audit, "sandbox");
      let success = false;
      try {
        const { report } = await sandbox.build(payload.files, { audit: true });
        const saved = check(
          await ctx.admin
            .from("scan_reports")
            .insert({
              project_id: req.project.id,
              type: "lighthouse",
              score: report.scores.performance,
              findings: report,
            })
            .select()
            .single(),
        );
        await ctx.finish(run, true);
        success = true;
        res.json({ report: saved });
      } finally {
        if (!success) await ctx.finish(run, false).catch(() => {});
      }
    }),
  );
  app.get(
    "/api/projects/:id/audits",
    ctx.auth,
    ctx.project(),
    wrap(async (req, res) =>
      res.json({
        reports: check(
          await ctx.admin
            .from("scan_reports")
            .select("*")
            .eq("project_id", req.project.id)
            .order("created_at", { ascending: false })
            .limit(10),
        ),
      }),
    ),
  );
}
