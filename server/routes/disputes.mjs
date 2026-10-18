import { z } from "zod";
import { HttpError, wrap } from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
import { notifyUser } from "../lib/notifications.mjs";
import { platformAdmin, schemaMissing } from "../lib/platform.mjs";

const setupNotice =
  "Sengketa marketplace belum disiapkan. Terapkan migration 014_marketplace_disputes.sql.";
const categories = ["not_as_described", "broken", "access", "other"];

/** Maps migration 014's SQL error codes to honest HTTP answers. */
function disputeCheck(result) {
  if (!result.error) return result.data;
  if (schemaMissing(result.error))
    throw new HttpError(503, setupNotice, "DISPUTE_SETUP");
  const message = result.error.message || "";
  if (message.includes("PIWU_FORBIDDEN"))
    throw new HttpError(
      403,
      "Akun ini tidak berhak atas tindakan sengketa tersebut.",
      "DISPUTE_FORBIDDEN",
    );
  if (message.includes("PIWU_DUPLICATE"))
    throw new HttpError(
      409,
      "Pesanan ini sudah pernah dilaporkan. Satu pesanan hanya punya satu sengketa.",
      "DISPUTE_DUPLICATE",
    );
  if (message.includes("PIWU_EXPIRED"))
    throw new HttpError(
      409,
      "Batas 30 hari untuk melaporkan pembelian ini sudah lewat.",
      "DISPUTE_EXPIRED",
    );
  if (message.includes("PIWU_INVALID"))
    throw new HttpError(400, "Data sengketa tidak valid.", "DISPUTE_INVALID");
  if (message.includes("ADMIN_NOT_FOUND"))
    throw new HttpError(404, "Sengketa tidak ditemukan.", "ADMIN_NOT_FOUND");
  if (message.includes("ADMIN_INVALID"))
    throw new HttpError(
      400,
      "Keputusan atau catatan tidak valid.",
      "ADMIN_INVALID",
    );
  if (message.includes("ADMIN_FORBIDDEN"))
    throw new HttpError(
      403,
      "Hanya superadmin yang boleh memutuskan sengketa.",
      "ADMIN_FORBIDDEN",
    );
  if (message.includes("ADMIN_DUPLICATE"))
    throw new HttpError(
      409,
      "ID permintaan sudah dipakai untuk keputusan berbeda.",
      "ADMIN_DUPLICATE",
    );
  throw new HttpError(
    503,
    "Operasi sengketa gagal; perubahan belum dikonfirmasi.",
  );
}

async function titlesFor(admin, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await admin
    .from("templates")
    .select("id,title")
    .in("id", unique);
  if (rows.error && !schemaMissing(rows.error))
    throw new HttpError(503, "Judul template belum dapat dimuat.");
  return new Map((rows.data || []).map((row) => [row.id, row.title]));
}

async function namesFor(admin, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await admin.from("users").select("id,name").in("id", unique);
  if (rows.error && !schemaMissing(rows.error))
    throw new HttpError(503, "Nama akun belum dapat dimuat.");
  return new Map((rows.data || []).map((row) => [row.id, row.name]));
}

/**
 * Buyer reports, seller replies, and a superadmin closes the report. PiwuApp
 * never refunds a transaction: a dispute holds the seller's share only while it
 * is unresolved (migration 015) and releases it when the report is closed.
 */
export function registerDisputes(app, ctx) {
  app.get(
    "/api/marketplace/disputes",
    ctx.auth,
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const admin = ctx.needAdmin();
      const [entitlements, disputes] = await Promise.all([
        admin
          .from("template_entitlements")
          .select("template_id,order_id,created_at")
          .eq("user_id", req.user.id),
        admin
          .from("marketplace_disputes")
          .select(
            "id,order_id,template_id,buyer_id,seller_id,category,body,status,seller_reply,resolution_note,opened_at,replied_at,resolved_at",
          )
          .or("buyer_id.eq." + req.user.id + ",seller_id.eq." + req.user.id)
          .order("opened_at", { ascending: false })
          .limit(100),
      ]);
      if (schemaMissing(disputes.error))
        return res.json({
          applied: false,
          purchases: [],
          as_buyer: [],
          as_seller: [],
          notice: setupNotice,
        });
      if (entitlements.error || disputes.error)
        throw new HttpError(503, "Sengketa belum dapat dimuat.");

      const orderIds = (entitlements.data || []).map((row) => row.order_id);
      const sales = orderIds.length
        ? await admin
            .from("marketplace_sales")
            .select("order_id,seller_id,net,status,created_at")
            .in("order_id", orderIds)
        : { data: [], error: null };
      if (sales.error && !schemaMissing(sales.error))
        throw new HttpError(503, "Data pembelian belum dapat dimuat.");
      const salesByOrder = new Map(
        (sales.data || []).map((row) => [row.order_id, row]),
      );
      const disputesByOrder = new Map(
        (disputes.data || []).map((row) => [row.order_id, row]),
      );
      const templateIds = [
        ...(entitlements.data || []).map((row) => row.template_id),
        ...(disputes.data || []).map((row) => row.template_id),
      ];
      const counterparties = (disputes.data || []).flatMap((row) => [
        row.buyer_id,
        row.seller_id,
      ]);
      const [titles, names] = await Promise.all([
        titlesFor(admin, templateIds),
        namesFor(admin, counterparties),
      ]);

      const purchases = (entitlements.data || []).map((row) => {
        const sale = salesByOrder.get(row.order_id);
        const dispute = disputesByOrder.get(row.order_id);
        const ageDays = sale
          ? (Date.now() - Date.parse(sale.created_at)) / 86400000
          : 999;
        return {
          order_id: row.order_id,
          template_id: row.template_id,
          title: titles.get(row.template_id) || "Template",
          acquired_at: row.created_at,
          seller_id: sale?.seller_id || null,
          seller_name: names.get(sale?.seller_id) || "",
          net: sale?.net || 0,
          status: dispute?.status || null,
          dispute_id: dispute?.id || null,
          can_open:
            !dispute &&
            sale?.status === "accrued" &&
            ageDays >= 0 &&
            ageDays <= 30,
        };
      });
      res.json({
        applied: true,
        purchases,
        as_buyer: (disputes.data || [])
          .filter((row) => row.buyer_id === req.user.id)
          .map((row) => ({
            ...row,
            title: titles.get(row.template_id) || "Template",
            counterparty: names.get(row.seller_id) || "",
          })),
        as_seller: (disputes.data || [])
          .filter((row) => row.seller_id === req.user.id)
          .map((row) => ({
            ...row,
            title: titles.get(row.template_id) || "Template",
            counterparty: names.get(row.buyer_id) || "",
          })),
      });
    }),
  );

  app.post(
    "/api/marketplace/disputes",
    ctx.auth,
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const body = z
        .object({
          orderId: z.uuid(),
          category: z.enum(categories),
          body: z.string().trim().min(20).max(2000),
        })
        .strict()
        .parse(req.body);
      const admin = ctx.needAdmin();
      const id = disputeCheck(
        await admin.rpc("piwu_dispute_open", {
          p_user: req.user.id,
          p_order: body.orderId,
          p_category: body.category,
          p_body: body.body,
        }),
      );
      const row = await admin
        .from("marketplace_disputes")
        .select("seller_id,template_id")
        .eq("id", id)
        .maybeSingle();
      if (row.data?.seller_id) {
        const titles = await titlesFor(admin, [row.data.template_id]);
        await notifyUser(ctx, row.data.seller_id, {
          kind: "marketplace",
          title: "Sengketa baru atas penjualan",
          body:
            "Pembeli melaporkan masalah pada “" +
            (titles.get(row.data.template_id) || "template") +
            "”. Balas dari halaman profil.",
          href: "/profile#sengketa",
          dedupe: "dispute-open:" + id,
        });
      }
      res.status(201).json({ id });
    }),
  );

  app.post(
    "/api/marketplace/disputes/:id/reply",
    ctx.auth,
    rateLimit({ max: 20 }),
    wrap(async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      const body = z
        .object({ body: z.string().trim().min(10).max(2000) })
        .strict()
        .parse(req.body);
      const admin = ctx.needAdmin();
      const status = disputeCheck(
        await admin.rpc("piwu_dispute_reply", {
          p_user: req.user.id,
          p_dispute: id,
          p_body: body.body,
        }),
      );
      const row = await admin
        .from("marketplace_disputes")
        .select("buyer_id,template_id")
        .eq("id", id)
        .maybeSingle();
      if (row.data?.buyer_id) {
        const titles = await titlesFor(admin, [row.data.template_id]);
        await notifyUser(ctx, row.data.buyer_id, {
          kind: "marketplace",
          title: "Penjual membalas sengketa",
          body:
            "Ada balasan untuk laporan “" +
            (titles.get(row.data.template_id) || "template") +
            "”. Baca dan putuskan apakah laporan ditarik.",
          href: "/profile#sengketa",
          dedupe: "dispute-reply:" + id,
        });
      }
      res.json({ status });
    }),
  );

  app.post(
    "/api/marketplace/disputes/:id/withdraw",
    ctx.auth,
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      const status = disputeCheck(
        await ctx.needAdmin().rpc("piwu_dispute_withdraw", {
          p_user: req.user.id,
          p_dispute: id,
        }),
      );
      res.json({ status });
    }),
  );

  app.get(
    "/api/admin/disputes",
    ctx.auth,
    platformAdmin(ctx, "auditor"),
    rateLimit({ max: 60 }),
    wrap(async (req, res) => {
      const admin = ctx.needAdmin();
      const rows = await admin
        .from("marketplace_disputes")
        .select(
          "id,order_id,template_id,buyer_id,seller_id,category,body,status,seller_reply,resolution_note,opened_at,replied_at,resolved_at",
        )
        .order("opened_at", { ascending: false })
        .limit(200);
      if (schemaMissing(rows.error))
        return res.json({ applied: false, items: [], notice: setupNotice });
      if (rows.error)
        throw new HttpError(503, "Antrean sengketa belum dapat dimuat.");
      const [titles, names] = await Promise.all([
        titlesFor(
          admin,
          (rows.data || []).map((row) => row.template_id),
        ),
        namesFor(
          admin,
          (rows.data || []).flatMap((row) => [row.buyer_id, row.seller_id]),
        ),
      ]);
      res.json({
        applied: true,
        items: (rows.data || []).map((row) => ({
          ...row,
          title: titles.get(row.template_id) || "Template",
          buyer_name: names.get(row.buyer_id) || "",
          seller_name: names.get(row.seller_id) || "",
        })),
      });
    }),
  );

  app.post(
    "/api/admin/disputes/:id",
    ctx.auth,
    platformAdmin(ctx, "superadmin"),
    rateLimit({ max: 20 }),
    wrap(async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      const body = z
        .object({
          requestId: z.uuid(),
          status: z.enum(["resolved", "rejected"]),
          note: z.string().trim().min(8).max(500),
        })
        .strict()
        .parse(req.body);
      const admin = ctx.needAdmin();
      const result = disputeCheck(
        await admin.rpc("piwu_dispute_review", {
          p_actor: req.user.id,
          p_request: body.requestId,
          p_dispute: id,
          p_status: body.status,
          p_note: body.note,
        }),
      );
      const titleRow = await admin
        .from("marketplace_disputes")
        .select("template_id")
        .eq("id", id)
        .maybeSingle();
      const title = titleRow.data?.template_id
        ? (await titlesFor(admin, [titleRow.data.template_id])).get(
            titleRow.data.template_id,
          )
        : null;
      const closed = body.status === "resolved";
      const message = closed
        ? "Sengketa ditutup. Tidak ada refund: transaksi bersifat final dan uang tidak berpindah. Bagian penjual kembali tersedia untuk payout."
        : "Sengketa ditolak: laporan tidak dipertahankan. Tidak ada refund, dan bagian penjual kembali tersedia untuk payout.";
      for (const userId of [result.buyer_id, result.seller_id])
        await notifyUser(ctx, userId, {
          kind: "marketplace",
          title: closed ? "Sengketa ditutup" : "Laporan sengketa ditolak",
          body: message + (title ? " Template: “" + title + "”." : ""),
          href: "/profile#sengketa",
          dedupe: "dispute-review:" + id + ":" + body.status,
        });
      res.json({ result: { ...result, notice: message } });
    }),
  );
}
