import { randomBytes } from "node:crypto";
import { z } from "zod";
import { HttpError, hash, wrap } from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
import { schemaMissing } from "../lib/platform.mjs";

const setupNotice =
  "API data aplikasi belum disiapkan. Terapkan migration 016_app_data_api.sql.";
const keyPrefix = "piwu_sk_";
const tableId = z.uuid();
const rowValue = z.union([
  z.string().max(4000),
  z.number().min(-1e15).max(1e15),
  z.boolean(),
  z.null(),
]);
const values = z.record(z.string(), rowValue);

/** Maps migration 016's SQL errors to honest HTTP answers. */
function appCheck(result) {
  if (!result.error) return result.data;
  if (schemaMissing(result.error))
    throw new HttpError(503, setupNotice, "APP_DATA_SETUP");
  const message = result.error.message || "";
  if (message.includes("PIWU_APP_KEY"))
    throw new HttpError(
      401,
      "Kunci API tidak valid atau sudah dicabut.",
      "APP_KEY_INVALID",
    );
  if (message.includes("PIWU_APP_READONLY"))
    throw new HttpError(
      403,
      "Kunci ini hanya boleh membaca. Buat kunci dengan akses tulis untuk mengubah data.",
      "APP_KEY_READONLY",
    );
  if (message.includes("PIWU_APP_NOT_FOUND"))
    throw new HttpError(
      404,
      "Tabel atau baris tidak ditemukan pada project ini.",
      "APP_NOT_FOUND",
    );
  if (message.includes("PIWU_APP_LIMIT"))
    throw new HttpError(
      409,
      "Batas 5 kunci aktif per project. Cabut kunci yang tidak dipakai dahulu.",
      "APP_KEY_LIMIT",
    );
  if (message.includes("PIWU_APP_INVALID"))
    throw new HttpError(400, "Data kunci API tidak valid.", "APP_INVALID");
  if (message.includes("PIWU_APP_FORBIDDEN") || result.error.code === "42501")
    throw new HttpError(
      403,
      "Hanya pemilik atau Editor project yang dapat mengelola kunci API.",
      "APP_FORBIDDEN",
    );
  if (message.includes("PIWU_DATA_LIMIT"))
    throw new HttpError(
      413,
      "Batas data: 1.000 baris, 32 kolom, dan 2 MB per tabel.",
      "DATA_LIMIT",
    );
  if (message.includes("PIWU_DATA_INVALID"))
    throw new HttpError(
      400,
      "Baris tidak sesuai kolom tabel (tipe nilai atau ID tidak valid).",
      "DATA_INVALID",
    );
  throw new HttpError(
    502,
    "Data belum dikonfirmasi oleh server. Perubahan mungkin belum tersimpan.",
  );
}

const keyFrom = (req) => {
  const raw = req.get("x-piwu-key") || "";
  const bearer = (req.get("authorization") || "").replace(/^Bearer /i, "");
  const value = (raw || bearer).trim();
  return value.startsWith(keyPrefix) ? value : "";
};

/**
 * Project data API for the app a user builds. A revocable per-project key (read
 * by default) replaces a user session; CORS is opened only on these public
 * routes. Keys are stored as SHA-256 hashes and shown once.
 */
export function registerAppData(app, ctx) {
  app.use("/api/public/app", (req, res, next) => {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "content-type,x-piwu-key,authorization",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  app.get(
    "/api/projects/:id/app-keys",
    ctx.auth,
    ctx.project("Viewer"),
    rateLimit({ max: 30 }),
    wrap(async (req, res) => {
      const keys = appCheck(
        await ctx.needAdmin().rpc("piwu_app_key_list", {
          p_actor: req.user.id,
          p_project: req.project.id,
        }),
      );
      res.json({ keys: keys || [] });
    }),
  );

  app.post(
    "/api/projects/:id/app-keys",
    ctx.auth,
    ctx.project("Editor"),
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const body = z
        .object({
          label: z.string().trim().min(1).max(60),
          scope: z.enum(["read", "write"]).default("read"),
        })
        .strict()
        .parse(req.body);
      // The plaintext key exists in this response and nowhere else.
      const secret = keyPrefix + randomBytes(24).toString("base64url");
      const key = appCheck(
        await ctx.needAdmin().rpc("piwu_app_key_create", {
          p_actor: req.user.id,
          p_project: req.project.id,
          p_id: crypto.randomUUID(),
          p_label: body.label,
          p_hash: hash(secret),
          p_scope: body.scope,
        }),
      );
      res.status(201).json({
        key,
        secret,
        notice:
          "Salin kunci ini sekarang. Server hanya menyimpan hash-nya; kunci tidak bisa ditampilkan lagi.",
      });
    }),
  );

  app.delete(
    "/api/projects/:id/app-keys/:keyId",
    ctx.auth,
    ctx.project("Editor"),
    rateLimit({ max: 20 }),
    wrap(async (req, res) => {
      const id = z.uuid().parse(req.params.keyId);
      appCheck(
        await ctx.needAdmin().rpc("piwu_app_key_revoke", {
          p_actor: req.user.id,
          p_project: req.project.id,
          p_id: id,
        }),
      );
      res.json({ revoked: true });
    }),
  );

  // Public app endpoints. The project id in the URL only selects the scope;
  // the key is the credential and it is checked against that project.
  const request = async (req, op, payload, table, respond) => {
    const secret = keyFrom(req);
    if (!secret)
      throw new HttpError(
        401,
        "Sertakan header x-piwu-key berisi kunci API project.",
        "APP_KEY_REQUIRED",
      );
    const result = appCheck(
      await ctx.needAdmin().rpc("piwu_app_request", {
        p_hash: hash(secret),
        p_table: table,
        p_op: op,
        p_payload: payload,
      }),
    );
    respond(result);
  };

  app.get(
    "/api/public/app/:projectId",
    rateLimit({ max: 120 }),
    wrap(async (req, res) => {
      if (!z.uuid().safeParse(req.params.projectId).success)
        throw new HttpError(400, "ID project tidak valid.");
      await request(req, "tables", null, null, (out) =>
        res.json({ tables: out.tables || [] }),
      );
    }),
  );

  app.get(
    "/api/public/app/:projectId/:tableId",
    rateLimit({ max: 120 }),
    wrap(async (req, res) => {
      const table = tableId.parse(req.params.tableId);
      await request(req, "list", null, table, (out) =>
        res.json({ table: out }),
      );
    }),
  );

  app.post(
    "/api/public/app/:projectId/:tableId",
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const table = tableId.parse(req.params.tableId);
      const body = z
        .object({
          rows: z
            .array(
              z
                .object({
                  id: z.uuid().optional(),
                  values,
                })
                .strict(),
            )
            .min(1)
            .max(50),
        })
        .strict()
        .parse(req.body);
      await request(req, "insert", body, table, (out) =>
        res.status(201).json({ table: out }),
      );
    }),
  );

  app.patch(
    "/api/public/app/:projectId/:tableId/:rowId",
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const table = tableId.parse(req.params.tableId);
      const row = z.uuid().parse(req.params.rowId);
      const body = z.object({ values }).strict().parse(req.body);
      await request(
        req,
        "update",
        { id: row, values: body.values },
        table,
        (out) => res.json({ table: out }),
      );
    }),
  );

  app.delete(
    "/api/public/app/:projectId/:tableId/:rowId",
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const table = tableId.parse(req.params.tableId);
      const row = z.uuid().parse(req.params.rowId);
      await request(req, "delete", { id: row }, table, (out) =>
        res.json({ table: out }),
      );
    }),
  );
}
