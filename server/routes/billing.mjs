import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  HttpError,
  check,
  wrap,
  uuid,
  appOrigin,
  capabilities,
} from "../lib/core.mjs";
import {
  productCatalog,
  paymentProvider,
  verifyPaymentHook,
} from "../providers/payments.mjs";
import { planOverridesOf, siteSettings } from "../lib/platform.mjs";
import { rateLimit } from "../lib/context.mjs";
import { creditStatus } from "../lib/credit-status.mjs";
import { notifyUser } from "../lib/notifications.mjs";
export function registerBilling(app, ctx) {
  app.get(
    "/api/account",
    ctx.auth,
    wrap(async (req, res) => {
      const admin = ctx.needAdmin();
      const balance = check(
        await admin.rpc("piwu_ensure_credits", { p_user: req.user.id }),
      );
      const ledger = check(
        await admin
          .from("credit_ledger")
          .select("id,delta,reason,created_at")
          .eq("user_id", req.user.id)
          .order("created_at", { ascending: false })
          .limit(30),
      );
      const orders = check(
        await admin
          .from("payment_orders")
          .select("id,kind,sku,amount,status,checkout_url,created_at")
          .eq("user_id", req.user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      );
      const plans = check(
        await admin
          .from("subscriptions")
          .select("plan,status,current_period_start,current_period_end")
          .eq("user_id", req.user.id)
          .eq("status", "active")
          .gt("current_period_end", new Date().toISOString())
          .lte("current_period_start", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1),
      );
      let code = check(
        await admin
          .from("referral_codes")
          .select("code")
          .eq("user_id", req.user.id)
          .maybeSingle(),
      );
      if (!code) {
        const created = await admin
          .from("referral_codes")
          .upsert(
            { user_id: req.user.id },
            { onConflict: "user_id", ignoreDuplicates: true },
          )
          .select("code");
        code =
          created.data?.[0] ||
          check(
            await admin
              .from("referral_codes")
              .select("code")
              .eq("user_id", req.user.id)
              .single(),
          );
      }
      const referrals = check(
        await admin
          .from("referrals")
          .select("reward_status")
          .eq("referrer_id", req.user.id),
      );
      // What the database says about today's allowance, asked after the claim
      // above (piwu_ensure_credits refills it) so the numbers describe the day
      // the account is actually in. A missing migration or an unreadable
      // answer comes back as `applied: false` with a note, never as a guess.
      const credits = await creditStatus(admin, req.user.id);
      // The catalogue is the default price list with whatever the
      // administrator saved, so checkout and this answer cannot disagree.
      const site = await siteSettings(ctx);
      const products = productCatalog(planOverridesOf(site.value));
      res.json({
        balance,
        credits,
        ledger,
        orders,
        plan: plans[0] || { plan: "Free" },
        products,
        paymentsEnabled: capabilities(ctx.env).payments,
        provider: ctx.env.PAYMENT_PROVIDER || null,
        referral: {
          code: code.code,
          total: referrals.length,
          rewarded: referrals.filter((x) => x.reward_status === "rewarded")
            .length,
        },
        sales: check(
          await admin
            .from("marketplace_sales")
            .select("gross,net,status,created_at")
            .eq("seller_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(100),
        ),
      });
    }),
  );
  app.post(
    "/api/checkout",
    ctx.auth,
    rateLimit({ max: 5 }),
    wrap(async (req, res) => {
      if (!capabilities(ctx.env).payments)
        throw new HttpError(
          503,
          "Pembayaran belum diaktifkan. Tidak ada tagihan yang dibuat.",
        );
      const { sku, templateId } = z
        .object({ sku: z.string().max(100), templateId: z.uuid().optional() })
        .parse(req.body);
      const site = await siteSettings(ctx);
      const products = productCatalog(planOverridesOf(site.value));
      let product = Object.hasOwn(products, sku) ? products[sku] : null;
      if (sku === "template" && templateId) {
        const t = check(
          await ctx
            .needAdmin()
            .from("templates")
            .select("id,title,price,owner_id")
            .eq("id", templateId)
            .eq("status", "published")
            .single(),
        );
        if (t.owner_id === req.user.id)
          throw new HttpError(
            400,
            "Template ini milik Anda. Tidak perlu membelinya.",
          );
        if (
          check(
            await ctx.admin
              .from("template_entitlements")
              .select("template_id")
              .eq("template_id", t.id)
              .eq("user_id", req.user.id)
              .maybeSingle(),
          )
        )
          throw new HttpError(409, "Anda sudah memiliki akses template ini.");
        if (!t.price)
          throw new HttpError(
            400,
            "Template gratis tidak memerlukan checkout.",
          );
        product = {
          kind: "template",
          amount: t.price,
          credits: 0,
          label: "Template " + t.title,
          template_id: t.id,
        };
      }
      if (!product) throw new HttpError(400, "Produk tidak tersedia.");
      const provider = paymentProvider(ctx.env, ctx.fetcher);
      const order = check(
        await ctx.admin
          .from("payment_orders")
          .insert({
            id: randomUUID(),
            user_id: req.user.id,
            provider: provider.name,
            sku,
            kind: product.kind,
            amount: product.amount,
            credits: product.credits,
            plan: product.plan || null,
            template_id: product.template_id || null,
            status: "created",
          })
          .select()
          .single(),
      );
      try {
        const checkout = await provider.checkout(
          order,
          product.label,
          req.user.email,
        );
        if (!checkout.url?.startsWith("https://"))
          throw new HttpError(
            502,
            "Provider tidak mengembalikan tautan checkout aman.",
          );
        check(
          await ctx.admin
            .from("payment_orders")
            .update({
              provider_id: checkout.providerId,
              checkout_url: checkout.url,
              status: "pending",
            })
            .eq("id", order.id),
        );
        res.json({
          orderId: order.id,
          url: checkout.url,
          amount: order.amount,
          currency: "IDR",
        });
      } catch (e) {
        await ctx.admin
          .from("payment_orders")
          .update({ status: "checkout_error" })
          .eq("id", order.id);
        throw e;
      }
    }),
  );
  async function refresh(order) {
    const p = paymentProvider(
      { ...ctx.env, PAYMENT_PROVIDER: order.provider },
      ctx.fetcher,
    );
    const status = await p.status(order);
    const applied = check(
      await ctx.admin.rpc("piwu_apply_payment", {
        p_id: order.id,
        p_amount: status.amount,
        p_currency: status.currency,
        p_state: status.state,
      }),
    );
    // piwu_apply_payment only returns "paid"/"refunded" on the transition, so
    // a retried refresh or webhook cannot notify twice. The bell is the same
    // row on every device; the dedupe key is a second guard.
    if (applied === "paid" || applied === "already_paid") {
      const detail =
        order.kind === "plan"
          ? `Paket ${order.plan} aktif selama 30 hari.`
          : order.kind === "template"
            ? "Template masuk ke koleksi Anda."
            : `${order.credits} kredit ditambahkan ke saldo.`;
      await notifyUser(ctx, order.user_id, {
        kind: "payment",
        title: "Pembayaran berhasil",
        body: detail,
        href: "/account",
        dedupe: "payment:" + order.id,
      });
      if (order.kind === "template" && order.template_id) {
        const template = await ctx.admin
          .from("templates")
          .select("owner_id,title")
          .eq("id", order.template_id)
          .maybeSingle();
        if (template.data && template.data.owner_id !== order.user_id)
          await notifyUser(ctx, template.data.owner_id, {
            kind: "marketplace",
            title: "Template terjual",
            body: `"${template.data.title}" dibeli. Catat pendapatannya di halaman akun.`,
            href: "/account",
            dedupe: "sale:" + order.id,
          });
      }
    } else if (applied === "refunded" || applied === "already_refunded") {
      await notifyUser(ctx, order.user_id, {
        kind: "payment",
        title: "Pembayaran dibatalkan penyedia",
        body: `Penyedia membatalkan atau menarik pembayaran pesanan ${order.sku}. Kredit, template, dan bonus terkait disesuaikan mengikuti status provider.`,
        href: "/account",
        dedupe: "refund:" + order.id,
      });
    }
    return applied;
  }
  app.post(
    "/api/orders/:orderId/refresh",
    ctx.auth,
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      if (!uuid(req.params.orderId))
        throw new HttpError(400, "ID pesanan tidak valid.");
      const order = check(
        await ctx
          .needAdmin()
          .from("payment_orders")
          .select("*")
          .eq("id", req.params.orderId)
          .eq("user_id", req.user.id)
          .single(),
      );
      res.json({ status: await refresh(order) });
    }),
  );
  app.post(
    "/api/webhooks/payments/:provider",
    rateLimit({ max: 120 }),
    wrap(async (req, res) => {
      const id = verifyPaymentHook(req.params.provider, req, ctx.env);
      if (!uuid(id)) throw new HttpError(400, "ID pesanan tidak valid.");
      const order = check(
        await ctx
          .needAdmin()
          .from("payment_orders")
          .select("*")
          .eq("id", id)
          .eq("provider", req.params.provider)
          .single(),
      );
      const status = await refresh(order);
      res.json({ received: true, status });
    }),
  );
  app.post(
    "/api/referrals/claim",
    ctx.auth,
    rateLimit({ max: 5 }),
    wrap(async (req, res) => {
      const code = z
        .string()
        .regex(/^[a-f0-9]{16,32}$/)
        .parse(req.body.code);
      if (Date.now() - Date.parse(req.user.created_at) > 7 * 86400000)
        throw new HttpError(
          400,
          "Referral hanya dapat diklaim dalam 7 hari sejak pendaftaran.",
        );
      if (!req.user.email_confirmed_at && !req.user.phone_confirmed_at)
        throw new HttpError(403, "Verifikasi akun terlebih dahulu.");
      const result = await ctx
        .needAdmin()
        .rpc("piwu_claim_referral", { p_user: req.user.id, p_code: code });
      if (result.error?.code === "23505")
        throw new HttpError(409, "Akun ini sudah mengklaim referral.");
      if (result.error?.message?.includes("PIWU_REFERRAL_AFTER_PAYMENT"))
        throw new HttpError(409, "Klaim kode sebelum pembayaran pertama.");
      if (result.error?.message?.includes("PIWU_REFERRAL_INVALID"))
        throw new HttpError(400, "Kode referral tidak valid untuk akun ini.");
      check(result);
      res.json({
        claimed: true,
        notice:
          "Bonus 50 kredit untuk kedua akun diberikan setelah pembayaran pertama terverifikasi.",
      });
    }),
  );
}
