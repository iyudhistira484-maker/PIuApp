import { z } from "zod";
import { HttpError, wrap } from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
import { platformAdmin, schemaMissing } from "../lib/platform.mjs";

const emptyBalance = {
  accrued: 0,
  pending: 0,
  paid: 0,
  available: 0,
  currency: "IDR",
};
const setupNotice =
  "Payout marketplace belum disiapkan. Terapkan migration 013_marketplace_payouts.sql.";

/** Maps the SQL error codes of migration 013 to honest HTTP answers. */
function payoutCheck(result) {
  if (!result.error) return result.data;
  if (schemaMissing(result.error))
    throw new HttpError(503, setupNotice, "PAYOUT_SETUP");
  const message = result.error.message || "";
  if (message.includes("PIWU_KYC_REQUIRED"))
    throw new HttpError(
      403,
      "Verifikasi penjual (KYC) diperlukan sebelum meminta payout.",
      "KYC_REQUIRED",
    );
  if (message.includes("PIWU_INSUFFICIENT"))
    throw new HttpError(
      409,
      "Saldo tersedia tidak cukup untuk payout ini.",
      "PAYOUT_INSUFFICIENT",
    );
  if (message.includes("PIWU_FORBIDDEN"))
    throw new HttpError(
      403,
      "Akun ini tidak dapat memakai payout.",
      "ACCOUNT_SUSPENDED",
    );
  if (message.includes("PIWU_INVALID"))
    throw new HttpError(400, "Data payout tidak valid.", "PAYOUT_INVALID");
  if (message.includes("ADMIN_NOT_FOUND"))
    throw new HttpError(404, "Data payout tidak ditemukan.", "ADMIN_NOT_FOUND");
  if (message.includes("ADMIN_INVALID"))
    throw new HttpError(
      400,
      "Status review atau datanya tidak valid.",
      "ADMIN_INVALID",
    );
  if (message.includes("ADMIN_FORBIDDEN"))
    throw new HttpError(
      403,
      "Hanya superadmin yang boleh meninjau KYC dan payout.",
      "ADMIN_FORBIDDEN",
    );
  if (message.includes("ADMIN_DUPLICATE"))
    throw new HttpError(
      409,
      "ID permintaan sudah dipakai untuk tindakan berbeda.",
      "ADMIN_DUPLICATE",
    );
  throw new HttpError(
    503,
    "Operasi payout gagal; perubahan belum dikonfirmasi.",
  );
}

/**
 * Seller payouts are reviewed, not automatic. Money moves outside PiwuApp;
 * these routes only record the request, the KYC decision, and the transfer
 * reference. Balances are derived from marketplace_sales by migration 013.
 */
export function registerPayouts(app, ctx) {
  app.get(
    "/api/marketplace/payouts",
    ctx.auth,
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const admin = ctx.needAdmin();
      const [verification, payouts, balance] = await Promise.all([
        admin
          .from("seller_verifications")
          .select(
            "status,legal_name,business_name,tax_id,country,note,submitted_at,reviewed_at",
          )
          .eq("user_id", req.user.id)
          .maybeSingle(),
        admin
          .from("marketplace_payouts")
          .select(
            "id,amount,method,destination,status,reference,note,created_at,paid_at",
          )
          .eq("seller_id", req.user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        admin.rpc("piwu_seller_balance", { p_user: req.user.id }),
      ]);
      if (
        schemaMissing(verification.error) ||
        schemaMissing(payouts.error) ||
        schemaMissing(balance.error)
      )
        return res.json({
          applied: false,
          verification: { status: "unverified" },
          balance: emptyBalance,
          payouts: [],
          notice: setupNotice,
        });
      if (verification.error || payouts.error || balance.error)
        throw new HttpError(503, "Data payout belum dapat dimuat.");
      res.json({
        applied: true,
        verification: verification.data || { status: "unverified" },
        balance: balance.data || emptyBalance,
        payouts: payouts.data || [],
      });
    }),
  );

  app.post(
    "/api/marketplace/kyc",
    ctx.auth,
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const body = z
        .object({
          legal_name: z.string().trim().min(2).max(120),
          business_name: z.string().trim().max(120).optional().default(""),
          tax_id: z.string().trim().max(40).optional().default(""),
          country: z.string().trim().min(2).max(56),
        })
        .strict()
        .parse(req.body);
      const status = payoutCheck(
        await ctx.needAdmin().rpc("piwu_seller_kyc_submit", {
          p_user: req.user.id,
          p_legal_name: body.legal_name,
          p_business_name: body.business_name || null,
          p_tax_id: body.tax_id || null,
          p_country: body.country,
        }),
      );
      res.json({ status });
    }),
  );

  app.post(
    "/api/marketplace/payouts",
    ctx.auth,
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const body = z
        .object({
          amount: z.number().int().min(50000).max(50000000),
          method: z.enum(["bank", "ewallet"]),
          destination: z.string().trim().min(4).max(120),
        })
        .strict()
        .parse(req.body);
      const id = payoutCheck(
        await ctx.needAdmin().rpc("piwu_request_payout", {
          p_user: req.user.id,
          p_amount: body.amount,
          p_method: body.method,
          p_destination: body.destination,
        }),
      );
      res.status(201).json({ id });
    }),
  );

  app.get(
    "/api/admin/payouts",
    ctx.auth,
    platformAdmin(ctx, "auditor"),
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const admin = ctx.needAdmin();
      const [sales, verifications, payouts, disputes] = await Promise.all([
        admin
          .from("marketplace_sales")
          .select("order_id,seller_id,net,status")
          .eq("status", "accrued")
          .limit(5000),
        admin
          .from("seller_verifications")
          .select(
            "user_id,status,legal_name,business_name,tax_id,country,note,submitted_at,reviewed_at",
          )
          .order("submitted_at", { ascending: false })
          .limit(200),
        admin
          .from("marketplace_payouts")
          .select(
            "id,seller_id,amount,method,destination,status,reference,note,created_at,paid_at",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        admin
          .from("marketplace_disputes")
          .select("order_id")
          .in("status", ["open", "seller_replied"])
          .limit(5000),
      ]);
      if (
        schemaMissing(sales.error) ||
        schemaMissing(verifications.error) ||
        schemaMissing(payouts.error)
      )
        return res.json({
          applied: false,
          sellers: [],
          verifications: [],
          payouts: [],
          notice: setupNotice,
        });
      if (sales.error || verifications.error || payouts.error)
        throw new HttpError(503, "Antrean payout belum dapat dimuat.");
      if (disputes.error && !schemaMissing(disputes.error))
        throw new HttpError(503, "Status sengketa belum dapat dibaca.");

      const balances = new Map();
      const entry = (id) => {
        if (!balances.has(id))
          balances.set(id, { accrued: 0, pending: 0, paid: 0, frozen: 0 });
        return balances.get(id);
      };
      // An unresolved dispute holds the seller's share of that order (migration
      // 015) so the queue shows the same available amount the seller sees.
      const frozenOrders = new Set(
        disputes.error && schemaMissing(disputes.error)
          ? []
          : (disputes.data || []).map((row) => row.order_id),
      );
      for (const row of sales.data || []) {
        const value = entry(row.seller_id);
        if (frozenOrders.has(row.order_id))
          value.frozen += Number(row.net) || 0;
        else value.accrued += Number(row.net) || 0;
      }
      for (const row of payouts.data || []) {
        const target = entry(row.seller_id);
        if (row.status === "paid") target.paid += Number(row.amount) || 0;
        else if (row.status === "requested" || row.status === "approved")
          target.pending += Number(row.amount) || 0;
      }
      const verificationRows = verifications.data ? [verifications.data] : [];
      for (const row of verificationRows) entry(row.user_id);

      const ids = [...balances.keys()];
      let names = new Map();
      if (ids.length) {
        const users = await admin.from("users").select("id,name").in("id", ids);
        if (users.error && !schemaMissing(users.error))
          throw new HttpError(503, "Nama penjual belum dapat dimuat.");
        names = new Map((users.data || []).map((u) => [u.id, u.name]));
      }
      const verificationsById = new Map(
        verificationRows.map((row) => [row.user_id, row]),
      );
      const sellers = ids.map((id) => {
        const value = balances.get(id);
        const verification = verificationsById.get(id);
        return {
          user_id: id,
          name: names.get(id) || "",
          accrued: value.accrued,
          pending: value.pending,
          paid: value.paid,
          frozen: value.frozen,
          available: Math.max(0, value.accrued - value.pending - value.paid),
          kyc_status: verification?.status || "unverified",
          legal_name: verification?.legal_name || "",
          country: verification?.country || "",
          business_name: verification?.business_name || "",
        };
      });
      res.json({
        applied: true,
        sellers,
        verifications: verificationRows,
        payouts: payouts.data || [],
      });
    }),
  );

  app.post(
    "/api/admin/payouts/kyc",
    ctx.auth,
    platformAdmin(ctx, "superadmin"),
    rateLimit({ max: 20 }),
    wrap(async (req, res) => {
      const body = z
        .object({
          requestId: z.uuid(),
          userId: z.uuid(),
          status: z.enum(["verified", "rejected"]),
          note: z.string().trim().max(500).optional().default(""),
        })
        .strict()
        .parse(req.body);
      if (body.status === "rejected" && body.note.trim().length < 8)
        throw new HttpError(
          400,
          "Alasan penolakan minimal 8 karakter.",
          "PAYOUT_INVALID",
        );
      const result = payoutCheck(
        await ctx.needAdmin().rpc("piwu_review_kyc", {
          p_actor: req.user.id,
          p_request: body.requestId,
          p_user: body.userId,
          p_status: body.status,
          p_note: body.note || null,
        }),
      );
      res.json({ result });
    }),
  );

  app.post(
    "/api/admin/payouts/:id",
    ctx.auth,
    platformAdmin(ctx, "superadmin"),
    rateLimit({ max: 20 }),
    wrap(async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      const body = z
        .object({
          requestId: z.uuid(),
          status: z.enum(["approved", "paid", "rejected"]),
          reference: z.string().trim().max(120).optional().default(""),
          note: z.string().trim().max(500).optional().default(""),
        })
        .strict()
        .parse(req.body);
      if (body.status === "paid" && body.reference.trim().length < 4)
        throw new HttpError(
          400,
          "Referensi transfer wajib 4–120 karakter.",
          "PAYOUT_INVALID",
        );
      if (body.status === "rejected" && body.note.trim().length < 8)
        throw new HttpError(
          400,
          "Alasan penolakan minimal 8 karakter.",
          "PAYOUT_INVALID",
        );
      const result = payoutCheck(
        await ctx.needAdmin().rpc("piwu_review_payout", {
          p_actor: req.user.id,
          p_request: body.requestId,
          p_payout: id,
          p_status: body.status,
          p_reference: body.reference || null,
          p_note: body.note || null,
        }),
      );
      res.json({ result });
    }),
  );
}
