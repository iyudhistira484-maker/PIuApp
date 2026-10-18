import { adminFilters, applyAdminFilters } from "../lib/admin-query.mjs";
import { createReadinessReader } from "../lib/readiness.mjs";
import { researchStatus } from "../lib/research.mjs";
import { GENERAL_TOOL_NAMES, toolRoundsMax } from "../lib/tools.mjs";
import { searchCacheInfo, searchCapability } from "../lib/search.mjs";
import { createPublicSiteReader } from "../lib/public-site.mjs";
import { z } from "zod";
import {
  HttpError,
  wrap,
  assertNoSecrets,
  capabilities,
} from "../lib/core.mjs";
import {
  mergePlans,
  mergeTopups,
  ratePerCredit,
} from "../../shared/credits.mjs";
import { rateLimit } from "../lib/context.mjs";
import {
  platformResult,
  platformAdmin,
  schemaMissing,
  siteSettings,
} from "../lib/platform.mjs";
import {
  aiOverview,
  accountDetail,
  runtimeOverview,
  storageOverview,
  studioOverview,
  LOW_BALANCE,
} from "../lib/admin-insights.mjs";
import { paymentProvider } from "../providers/payments.mjs";
import { retireIdentity } from "../lib/account-retire.mjs";
import { notifyUser } from "../lib/notifications.mjs";
const priceOverride = z
  .object({
    amount: z.number().int().min(1000).max(100000000),
    credits: z.number().int().min(10).max(1000000),
  })
  .strict();
/**
 * Prices and credits per package, editable from the panel. Daily allowance,
 * monthly cap and expiry are not here: migration 010 enforces those.
 */
const planOverrides = z
  .object({
    pro: priceOverride.optional(),
    team: priceOverride.optional(),
    credits300: priceOverride.optional(),
    credits1400: priceOverride.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const plans = mergePlans(value);
    const pro = plans.find((row) => row.plan === "Pro");
    const team = plans.find((row) => row.plan === "Team");
    if (!pro || !team) return;
    if (team.credits <= pro.credits)
      ctx.addIssue({
        code: "custom",
        path: ["team", "credits"],
        message: "Team harus memberi kredit lebih banyak daripada Pro.",
      });
    else if (
      ratePerCredit(team.monthly, team.credits) >
      ratePerCredit(pro.monthly, pro.credits)
    )
      ctx.addIssue({
        code: "custom",
        path: ["team", "amount"],
        message: "Harga per kredit Team tidak boleh lebih mahal daripada Pro.",
      });
    const [small, large] = mergeTopups(value);
    if (large.credits <= small.credits)
      ctx.addIssue({
        code: "custom",
        path: ["credits1400", "credits"],
        message: "Top-up besar harus memberi kredit lebih banyak.",
      });
    else if (
      ratePerCredit(large.amount, large.credits) >
      ratePerCredit(small.amount, small.credits)
    )
      ctx.addIssue({
        code: "custom",
        path: ["credits1400", "amount"],
        message: "Harga per kredit top-up besar tidak boleh lebih mahal.",
      });
  });
/** Lowest package an operator may require for a capability. */
const planFeatures = z
  .object({
    sandbox: z.enum(["free", "pro", "team"]).optional(),
    studio: z.enum(["free", "pro", "team"]).optional(),
    marketplace_sell: z.enum(["free", "pro", "team"]).optional(),
  })
  .strict();
export const siteSchema = z
  .object({
    maintenance: z.boolean(),
    maintenance_message: z.string().trim().min(1).max(300),
    hero_title: z.string().max(100),
    hero_subtitle: z.string().max(500),
    support_email: z.union([z.email(), z.literal("")]),
    enabled_services: z
      .object({
        ai: z.boolean(),
        sandbox: z.boolean(),
        payments: z.boolean(),
        marketplace: z.boolean(),
        // Absent in settings saved before the Studio switch existed: treated
        // as enabled, like every other switch.
        studio: z.boolean().optional(),
        // Package prices live beside the switches so migration 005's
        // whitelist keeps working without a new migration. The same is true
        // for the per-package access matrix.
        plan_overrides: planOverrides.optional(),
        plan_features: planFeatures.optional(),
      })
      .strict(),
  })
  .strict();
const broadcast = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
    audience: z.enum(["public", "members", "pro", "team"]),
    status: z.enum(["draft", "published", "archived"]),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime().nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) => !v.ends_at || Date.parse(v.ends_at) > Date.parse(v.starts_at),
    "Waktu berakhir harus setelah mulai.",
  );
const schemas = {
  admin_role: z
    .object({ role: z.enum(["superadmin", "operator", "auditor", "remove"]) })
    .strict(),
  user_suspend: z.object({ suspended: z.boolean() }).strict(),
  user_delete: z.object({ confirmation: z.uuid() }).strict(),
  credits: z
    .object({
      delta: z
        .number()
        .int()
        .min(-10000)
        .max(10000)
        .refine((v) => v !== 0),
    })
    .strict(),
  project_lock: z.object({ locked: z.boolean() }).strict(),
  project_delete: z.object({ confirmation: z.uuid() }).strict(),
  template_status: z
    .object({ status: z.enum(["published", "archived"]) })
    .strict(),
  recording_revoke: z.object({}).strict(),
  payment_reconcile: z.object({}).strict(),
  broadcast_save: broadcast,
  settings: z
    .object({ revision: z.number().int().positive(), value: siteSchema })
    .strict(),
};
export function adminCommand(body) {
  const command = z
    .object({
      requestId: z.uuid(),
      action: z.string(),
      target: z.uuid().nullable(),
      payload: z.unknown(),
      reason: z.string().trim().min(8).max(500),
    })
    .strict()
    .parse(body);
  if (!Object.hasOwn(schemas, command.action))
    throw new HttpError(400, "Tindakan admin tidak dikenali.");
  command.payload = schemas[command.action].parse(command.payload);
  if (command.action !== "settings" && !command.target)
    throw new HttpError(400, "Pilih data tujuan terlebih dahulu.");
  assertNoSecrets(command);
  return command;
}
const pageOf = (req) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .parse(req.query.page || 1);
export function registerAdmin(app, ctx) {
  const auth = [ctx.auth, platformAdmin(ctx), rateLimit({ max: 60 })];
  app.get(
    "/api/admin/session",
    ...auth,
    wrap(async (req, res) =>
      res.json({
        role: req.adminRole,
        userId: req.user.id,
        email: req.user.email || "",
        capabilities: capabilities(ctx.env),
      }),
    ),
  );
  app.get(
    "/api/admin/overview",
    ...auth,
    wrap(async (req, res) => {
      const count = async (table, filter) => {
        let q = ctx.admin
          .from(table)
          .select("*", { count: "exact", head: true });
        if (filter) q = filter(q);
        const r = await q;
        platformResult(r);
        return r.count || 0;
      };
      // Credits and cloud copies joined the product, so the top of the panel
      // shows the two states an operator has to act on: accounts about to run
      // out (the same threshold the dashboard uses) and copies that stopped
      // syncing. Both are read-only counts.
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const optionalCount = async (table, filter) => {
        try {
          return await count(table, filter);
        } catch (error) {
          // A migration that has not been applied yet (ADMIN_SETUP) must not
          // take the whole overview down with it; every other failure is real
          // and still surfaces to the caller.
          if (error?.code === "ADMIN_SETUP") return null;
          throw error;
        }
      };
      const [
        projects,
        pending,
        templates,
        broadcasts,
        lowBalance,
        dormantWorkspaces,
      ] = await Promise.all([
        count("projects"),
        count("payment_orders", (q) =>
          q.in("status", ["created", "pending", "checkout_error", "review"]),
        ),
        count("templates", (q) => q.eq("status", "published")),
        count("platform_broadcasts", (q) => q.eq("status", "published")),
        optionalCount("credit_accounts", (q) => q.lt("balance", LOW_BALANCE)),
        optionalCount("project_workspaces", (q) => q.lt("updated_at", cutoff)),
      ]);
      res.json({
        metrics: {
          projects,
          pending,
          templates,
          broadcasts,
          lowBalance,
          dormantWorkspaces,
          lowBalanceThreshold: LOW_BALANCE,
        },
        recent: platformResult(
          await ctx.admin
            .from("platform_audit")
            .select("id,actor_id,action,target_id,reason,created_at")
            .order("created_at", { ascending: false })
            .limit(8),
        ),
      });
    }),
  );
  app.get(
    "/api/admin/users",
    ...auth,
    wrap(async (req, res) => {
      const filters = adminFilters(req.query, "users");
      res.json(
        platformResult(
          await ctx.admin.rpc("piwu_admin_users", {
            p_actor: req.user.id,
            p_query: filters.q,
            p_page: filters.page,
          }),
        ),
      );
    }),
  );
  const lists = {
    projects: [
      "projects",
      "id,name,owner_id,created_at,updated_at",
      "updated_at",
    ],
    payments: [
      "payment_orders",
      "id,user_id,provider,kind,sku,amount,status,created_at",
      "created_at",
    ],
    marketplace: [
      "templates",
      "id,owner_id,title,category,price,status,created_at",
      "created_at",
    ],
    broadcasts: [
      "platform_broadcasts",
      "id,title,body,audience,status,starts_at,ends_at,revision,updated_at",
      "updated_at",
    ],
    audit: [
      "platform_audit",
      "id,actor_id,action,target_id,reason,result,created_at",
      "created_at",
    ],
    roles: [
      "platform_admins",
      "user_id,role,granted_by,created_at",
      "created_at",
    ],
  };
  for (const [path, [table, columns, order]] of Object.entries(lists))
    app.get(
      "/api/admin/" + path,
      ...auth,
      wrap(async (req, res) => {
        const filters = adminFilters(req.query, path),
          page = filters.page;
        const query = applyAdminFilters(
          ctx.admin.from(table).select(columns),
          path,
          filters,
          order,
        );
        const rows = platformResult(
          await query
            .order(order, { ascending: false })
            .order(path === "roles" ? "user_id" : "id", { ascending: false })
            .range((page - 1) * 25, page * 25),
        );
        const hasMore = rows.length > 25,
          items = rows.slice(0, 25);
        if (path === "projects") {
          const ids = items.map((r) => r.id);
          const controls = ids.length
            ? platformResult(
                await ctx.admin
                  .from("platform_project_controls")
                  .select("project_id,locked")
                  .in("project_id", ids),
              )
            : [];
          for (const row of items)
            row.locked =
              controls.find((c) => c.project_id === row.id)?.locked || false;
        }
        if (path === "broadcasts") {
          for (const row of items) {
            const result = await ctx.admin
              .from("broadcast_reads")
              .select("*", { count: "exact", head: true })
              .eq("broadcast_id", row.id);
            platformResult(result);
            row.read_count = result.count || 0;
          }
        }
        res.json({ page, hasMore, items });
      }),
    );
  app.get(
    "/api/admin/operations",
    ...auth,
    wrap(async (req, res) =>
      res.json({
        recordings: platformResult(
          await ctx.admin
            .from("recording_shares")
            .select(
              "id,recording_id,created_by,expires_at,revoked_at,created_at",
            )
            .order("created_at", { ascending: false })
            .limit(30),
        ),
        capabilities: capabilities(ctx.env),
      }),
    ),
  );
  const readiness = createReadinessReader(ctx);
  app.get(
    "/api/admin/ai",
    ...auth,
    rateLimit({ max: 20 }),
    wrap(async (req, res) =>
      res.json(await aiOverview(ctx, { refresh: req.query.refresh === "1" })),
    ),
  );
  app.get(
    "/api/admin/users/:id",
    ...auth,
    wrap(async (req, res) =>
      res.json(await accountDetail(ctx, z.uuid().parse(req.params.id))),
    ),
  );
  app.get(
    "/api/admin/runtime",
    ...auth,
    rateLimit({ max: 30 }),
    wrap(async (req, res) =>
      res.json(await runtimeOverview(ctx, app.locals.coordination)),
    ),
  );
  app.get(
    "/api/admin/diagnostics",
    ...auth,
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      let schema = "not_configured";
      if (ctx.admin) {
        try {
          const r = await ctx.admin
            .from("runtime_sandbox_slots")
            .select("project_id")
            .limit(0)
            .abortSignal(AbortSignal.timeout(5000));
          schema = r.error
            ? ["42P01", "PGRST205"].includes(r.error.code)
              ? "schema_missing"
              : "unreachable"
            : "reachable";
        } catch {
          schema = "unreachable";
        }
      }
      res.json({
        readiness: await readiness(),
        runtime: {
          rateLimitMode: app.locals.coordination.mode,
          coordinationSchema: schema,
          sandboxRouting:
            app.locals.coordination.mode === "database"
              ? "sticky-owner-lease"
              : "process-local",
        },
        // Read-only search status: which provider is selected, whether its key
        // is present, and what the cache is doing. Never the key itself.
        // `await` matters here: the job store reports the durable half from the
        // database, not only this process's memory.
        search: await (async () => {
          const capability = searchCapability(ctx.env);
          return {
            ...researchStatus(ctx.env),
            selected: capability.selected,
            selectedAvailable: capability.selectedAvailable,
            disabled: capability.disabled,
            keyConfigured: Boolean(ctx.env.SEARCH_API_KEY),
            // The read-only server tools that run on ordinary turns too: their
            // names and their round budget, and never a claim that a model used
            // them. The synthesis switch is already part of researchStatus().
            tools: {
              names: [...GENERAL_TOOL_NAMES],
              rounds: toolRoundsMax(ctx.env),
            },
            locale: {
              country: ctx.env.SEARCH_COUNTRY || "",
              language: ctx.env.SEARCH_LANGUAGE || "",
            },
            cache: searchCacheInfo(ctx),
            // Research that outlived its tab: how many answers wait to be
            // collected, with no prompt or credential in the count.
            jobs: ctx.researchJobs ? await ctx.researchJobs.stats() : null,
            notice:
              "Status konfigurasi, bukan bukti panggilan vendor berhasil. Untuk uji nyata jalankan npm run verify:search di server.",
          };
        })(),
        // The two features added after the first panel: cloud copies with the
        // backup story behind them, and the Roblox Studio bridge with the
        // plugin version the server hands out.
        storage: await storageOverview(ctx),
        studio: await studioOverview(ctx),
        liveVerified: false,
        notice:
          "Probe read-only: bukan bukti transaksi, inference, deployment, uji perangkat, atau kelulusan pentest.",
      });
    }),
  );
  app.get(
    "/api/admin/settings",
    ...auth,
    wrap(async (req, res) => res.json(await siteSettings(ctx))),
  );
  app.post(
    "/api/admin/actions",
    ctx.auth,
    platformAdmin(ctx, "operator"),
    rateLimit({ max: 20 }),
    wrap(async (req, res) => {
      const command = adminCommand(req.body);
      if (
        [
          "admin_role",
          "credits",
          "user_suspend",
          "user_delete",
          "settings",
          "project_delete",
        ].includes(command.action) &&
        req.adminRole !== "superadmin"
      )
        throw new HttpError(403, "Tindakan ini hanya untuk superadmin.");
      if (command.action === "payment_reconcile") {
        const previous = platformResult(
          await ctx.admin
            .from("platform_audit")
            .select("actor_id,action,target_id,reason,result")
            .eq("id", command.requestId)
            .maybeSingle(),
        );
        if (previous) {
          if (
            previous.actor_id !== req.user.id ||
            previous.action !== command.action ||
            previous.target_id !== command.target ||
            previous.reason !== command.reason
          )
            throw new HttpError(409, "ID permintaan sudah digunakan.");
          return res.json({
            result: previous.result,
            notice: "Hasil rekonsiliasi sebelumnya; tidak dijalankan ulang.",
          });
        }
        const order = platformResult(
          await ctx.admin
            .from("payment_orders")
            .select("*")
            .eq("id", command.target)
            .single(),
        );
        const provider = paymentProvider(
          { ...ctx.env, PAYMENT_PROVIDER: order.provider },
          ctx.fetcher,
        );
        const status = await provider.status(order);
        command.payload = status;
      }
      // Account removal needs its own RPC: the personal rows go first, then the
      // Auth identity is retired through the Admin API. Retrying the same
      // request id returns the audit result and only repeats the Auth step.
      const result = platformResult(
        await ctx.admin.rpc(
          command.action === "user_delete"
            ? "piwu_admin_delete_account"
            : "piwu_admin_action",
          {
            p_actor: req.user.id,
            p_request: command.requestId,
            ...(command.action === "user_delete"
              ? {}
              : { p_action: command.action }),
            p_target: command.target,
            p_payload: command.payload,
            p_reason: command.reason,
          },
        ),
      );
      if (command.action === "user_delete") {
        // Migration 013 data is not covered by 011 (it did not exist then):
        // remove KYC and the transfer destination before the identity retires.
        const purged = await ctx.admin.rpc("piwu_purge_seller_pii", {
          p_user: command.target,
        });
        if (purged.error && !schemaMissing(purged.error))
          throw new HttpError(
            502,
            "Akun sudah ditangguhkan dan data pribadi dihapus, tetapi data penjual belum dibersihkan. Ulangi permintaan yang sama.",
            "ACCOUNT_PAYOUT_PURGE",
          );
        await retireIdentity(ctx.admin, command.target);
      }
      if (command.action === "credits" && command.target) {
        const delta = Number(command.payload.delta) || 0;
        await notifyUser(ctx, command.target, {
          kind: "credits",
          title: "Saldo kredit disesuaikan",
          body:
            "Administrator " +
            (delta > 0 ? "menambah " : "mengurangi ") +
            Math.abs(delta) +
            " kredit. Saldo sekarang " +
            (result.balance ?? "diperbarui") +
            ".",
          href: "/account",
          dedupe: "admin-credit:" + command.requestId,
        });
      }
      res.json({
        result,
        notice: "Perubahan dikonfirmasi dan dicatat dalam audit log.",
      });
    }),
  );
  const publicSite = createPublicSiteReader(ctx);
  app.get(
    "/api/public/site",
    wrap(async (req, res) => res.json(await publicSite())),
  );
  app.get(
    "/api/announcements",
    ctx.auth,
    wrap(async (req, res) =>
      res.json({
        broadcasts: platformResult(
          await ctx
            .needAdmin()
            .rpc("piwu_broadcast_feed", { p_user: req.user.id }),
        ),
      }),
    ),
  );
  app.post(
    "/api/announcements/:id/read",
    ctx.auth,
    rateLimit({ max: 30 }),
    wrap(async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      platformResult(
        await ctx
          .needAdmin()
          .rpc("piwu_broadcast_read", { p_user: req.user.id, p_id: id }),
      );
      res.json({ read: true });
    }),
  );
}
