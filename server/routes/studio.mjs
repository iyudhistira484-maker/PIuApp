import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  wrap,
  HttpError,
  check,
  token,
  hash,
  assertNoSecrets,
} from "../lib/core.mjs";
import { rateLimit } from "../lib/context.mjs";
import {
  userActive,
  projectUnlocked,
  enforcePlatform,
} from "../lib/platform.mjs";
import {
  snapshotSchema,
  bundleSchema,
  validateBundle,
  canonical,
  STUDIO_PLUGIN,
} from "../../shared/studio.mjs";
import {
  SCENE_ASSET_FILE,
  SCENE_FILE,
  parseScene,
  readSceneAssets,
  sceneSummary,
} from "../lib/roblox-scene.mjs";
import {
  openCloudConfig,
  operationState,
  uploadModel,
} from "../lib/open-cloud.mjs";
export function registerStudio(app, ctx) {
  const table = () => ctx.needAdmin().from("studio_bridges");
  const get = async (id) =>
    check(await table().select("*").eq("project_id", id).maybeSingle());
  const alive = (row) => row && Date.parse(row.expires_at) > Date.now();
  const studioProject = wrap(async (req, res, next) => {
    const { payload } = await ctx.snapshot(req.project.id);
    if (payload.kind !== "roblox")
      throw new HttpError(409, "Bridge hanya tersedia untuk project Roblox.");
    next();
  });
  const guard = [ctx.auth, ctx.project("Editor"), studioProject];
  app.post(
    "/api/projects/:id/studio/connect",
    ...guard,
    rateLimit({ max: 6 }),
    wrap(async (req, res) => {
      const old = await get(req.project.id);
      if (alive(old) && old.state === "applying")
        throw new HttpError(
          409,
          "Tunggu operasi Studio selesai sebelum memasangkan ulang.",
        );
      const credential = token(),
        expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
      const data = {
        project_id: req.project.id,
        user_id: req.user.id,
        token_hash: hash(credential),
        expires_at: expiresAt,
        snapshot: null,
        snapshot_id: null,
        bundle: null,
        bundle_id: null,
        state: "idle",
        receipt: null,
        updated_at: new Date().toISOString(),
      };
      const saved = check(
        await (
          old
            ? table()
                .update(data)
                .eq("project_id", req.project.id)
                .eq("token_hash", old.token_hash)
                .eq("state", old.state)
            : table().insert(data)
        )
          .select("project_id")
          .maybeSingle(),
      );
      if (!saved)
        throw new HttpError(
          409,
          "Bridge berubah. Periksa kembali sebelum memasangkan.",
        );
      res.json({ token: credential, expiresAt });
    }),
  );
  app.get(
    "/api/projects/:id/studio",
    ...guard,
    wrap(async (req, res) => {
      const row = await get(req.project.id);
      res.json(
        row
          ? {
              connected: alive(row),
              expiresAt: row.expires_at,
              // When the snapshot was stored: the AI reads this same snapshot,
              // so the panel can say how fresh the context is.
              updatedAt: row.updated_at,
              snapshot: row.snapshot,
              state: row.state,
              receipt: row.receipt,
            }
          : { connected: false, state: "idle" },
      );
    }),
  );
  app.delete(
    "/api/projects/:id/studio",
    ...guard,
    wrap(async (req, res) => {
      check(await table().delete().eq("project_id", req.project.id));
      res.json({ revoked: true });
    }),
  );
  app.post(
    "/api/projects/:id/studio/send",
    ...guard,
    rateLimit({ max: 10 }),
    wrap(async (req, res) => {
      const row = await get(req.project.id);
      if (!alive(row) || !row.snapshot)
        throw new HttpError(
          409,
          "Hubungkan Studio dan kirim snapshot terlebih dahulu.",
        );
      if (["queued", "applying"].includes(row.state))
        throw new HttpError(
          409,
          "Selesaikan atau cabut antrean yang ada sebelum mengirim lagi.",
        );
      const bundle = bundleSchema.parse(req.body);
      assertNoSecrets(bundle);
      try {
        validateBundle(row.snapshot, bundle);
      } catch {
        throw new HttpError(
          409,
          "Bundle tidak cocok atau mengubah objek terlindungi. Impor ulang snapshot.",
        );
      }
      const saved = check(
        await table()
          .update({
            bundle,
            bundle_id: bundle.id,
            state: "queued",
            receipt: null,
          })
          .eq("project_id", req.project.id)
          .eq("token_hash", row.token_hash)
          .eq("snapshot_id", bundle.baseSnapshotId)
          .eq("state", row.state)
          .select("project_id")
          .maybeSingle(),
      );
      if (!saved) throw new HttpError(409, "Bridge berubah. Muat ulang.");
      res.json({ queued: true, id: bundle.id });
    }),
  );
  const plugin = wrap(async (req, res, next) => {
    const value = req.get("Authorization")?.replace(/^Bearer /, "") || "";
    if (value.length < 32 || value.length > 200)
      throw new HttpError(401, "Token plugin tidak valid.");
    const row = check(
      await table().select("*").eq("token_hash", hash(value)).maybeSingle(),
    );
    if (!alive(row))
      throw new HttpError(401, "Token plugin kedaluwarsa atau dicabut.");
    await userActive(ctx, row.user_id);
    await projectUnlocked(ctx, row.project_id);
    await enforcePlatform(ctx, req);
    const p = check(
      await ctx
        .needAdmin()
        .from("projects")
        .select("owner_id")
        .eq("id", row.project_id)
        .maybeSingle(),
    );
    const role =
      p?.owner_id === row.user_id
        ? "Owner"
        : check(
            await ctx
              .needAdmin()
              .from("collaborators")
              .select("role")
              .eq("project_id", row.project_id)
              .eq("user_id", row.user_id)
              .maybeSingle(),
          )?.role;
    if (!["Owner", "Editor"].includes(role))
      throw new HttpError(403, "Izin project telah dicabut.");
    const { payload } = await ctx.snapshot(row.project_id);
    if (payload.kind !== "roblox")
      throw new HttpError(
        409,
        "Jenis project berubah; pasangkan project Roblox yang benar.",
      );
    req.bridge = row;
    req.bridgePayload = payload;
    next();
  });
  app.get(
    "/api/studio/status",
    rateLimit({ max: 60 }),
    plugin,
    wrap(async (req, res) => {
      const payload = req.bridgePayload,
        files = payload.files || {};
      const stored = readSceneAssets(files[SCENE_ASSET_FILE]);
      let scene = null,
        sceneProblem = "";
      try {
        scene = parseScene(files[SCENE_FILE]);
      } catch (error) {
        sceneProblem =
          error instanceof HttpError
            ? error.message
            : "Scene project tidak terbaca.";
      }
      res.json({
        plugin: { version: STUDIO_PLUGIN.version },
        project: {
          id: req.bridge.project_id,
          name: String(payload.name || "Project"),
          kind: payload.kind || "roblox",
        },
        bridge: {
          state: req.bridge.state,
          expiresAt: req.bridge.expires_at,
          snapshotNodes: req.bridge.snapshot?.nodes?.length || 0,
          placeId: req.bridge.snapshot?.placeId || "",
          queuedChanges:
            req.bridge.state === "queued"
              ? req.bridge.bundle?.changes?.length || 0
              : 0,
          receipt: req.bridge.receipt || null,
        },
        scene: scene ? sceneSummary(scene, stored.assets) : null,
        sceneProblem,
        assets: {
          configured: openCloudConfig(ctx.env).configured,
          problem: stored.problem,
        },
        limits: STUDIO_PLUGIN.limits,
      });
    }),
  );
  app.get(
    "/api/studio/scene",
    rateLimit({ max: 30 }),
    plugin,
    wrap(async (req, res) => {
      const payload = req.bridgePayload,
        files = payload.files || {};
      const scene = parseScene(files[SCENE_FILE]);
      const stored = readSceneAssets(files[SCENE_ASSET_FILE]);
      const summary = sceneSummary(scene, stored.assets);
      const notes = [
        "Scene ini dibangun sebagai Part/Model; mesh kustom hanya bisa masuk lewat aset Roblox atau impor GLB manual.",
      ];
      if (summary.meshes.withoutAsset)
        notes.push(
          `${summary.meshes.withoutAsset} mesh kustom belum punya aset Roblox: ${summary.meshes.missing.join(", ")}. ${
            openCloudConfig(ctx.env).configured
              ? "Unggah dari panel Properti di PiwuApp supaya plugin bisa menyisipkannya."
              : "Server ini belum dikonfigurasi untuk unggah aset; pakai Ekspor GLB lalu impor manual di Studio."
          }`,
        );
      if (stored.problem) notes.push(stored.problem);
      res.json({
        project: {
          id: req.bridge.project_id,
          name: String(payload.name || ""),
        },
        revision: req.bridge.updated_at || "",
        scene,
        assets: stored.assets,
        assetsConfigured: openCloudConfig(ctx.env).configured,
        summary,
        notes,
      });
    }),
  );
  app.post(
    "/api/studio/snapshot",
    rateLimit({ max: 30 }),
    plugin,
    wrap(async (req, res) => {
      const snapshot = snapshotSchema.parse(req.body);
      assertNoSecrets(snapshot);
      const row = req.bridge;
      if (row.snapshot && row.snapshot.placeId !== snapshot.placeId)
        throw new HttpError(
          409,
          "Place berubah. Pasangkan ulang bridge secara eksplisit.",
        );
      if (["queued", "applying"].includes(row.state))
        throw new HttpError(
          409,
          "Selesaikan antrean perubahan sebelum snapshot baru.",
        );
      const saved = check(
        await table()
          .update({
            snapshot,
            snapshot_id: snapshot.snapshotId,
            bundle: null,
            bundle_id: null,
            state: "idle",
            receipt: null,
            updated_at: new Date().toISOString(),
          })
          .eq("token_hash", row.token_hash)
          .eq("state", row.state)
          .select("project_id")
          .maybeSingle(),
      );
      if (!saved) throw new HttpError(409, "Bridge berubah.");
      res.json({ received: true });
    }),
  );
  app.get(
    "/api/studio/pending",
    rateLimit({ max: 60 }),
    plugin,
    wrap(async (req, res) =>
      res.json({
        state: req.bridge.state,
        bundle: req.bridge.state === "queued" ? req.bridge.bundle : null,
      }),
    ),
  );
  const assetGuard = [ctx.auth, ctx.project("Editor")];
  app.post(
    "/api/projects/:id/studio/assets",
    ...assetGuard,
    rateLimit({ max: 4 }),
    wrap(async (req, res) => {
      const body = z
        .object({
          name: z.string().trim().min(1).max(80),
          objectId: z.string().regex(/^[\w:.-]{1,100}$/),
          glb: z
            .string()
            .min(32)
            .max(12 * 1024 * 1024),
        })
        .strict()
        .parse(req.body);
      const buffer = Buffer.from(body.glb, "base64");
      if (!buffer.length)
        throw new HttpError(400, "Berkas GLB yang dikirim kosong.");
      const config = openCloudConfig(ctx.env);
      if (!config.configured)
        throw new HttpError(
          503,
          "Unggah aset ke Roblox belum dikonfigurasi di server ini: isi ROBLOX_OPEN_CLOUD_KEY dan ROBLOX_ASSET_CREATOR_ID (docs/SERVICES_SETUP.md). Jalur manual tetap tersedia: Ekspor GLB di panel Properti lalu impor di Studio.",
        );
      const result = await uploadModel(
        {
          fetcher: ctx.fetcher,
          config,
          name: `${body.name} (PiwuApp)`,
          description: `Model PiwuApp project ${req.project.id} (objek ${body.objectId}).`,
        },
        buffer,
      );
      res.json({
        ...result,
        objectId: body.objectId,
        bytes: buffer.length,
        creator: `${config.creatorType}:${config.creatorId}`,
        notice:
          "Aset 3D masuk moderasi Roblox. Id aset bisa muncul sebelum aset benar-benar bisa dipakai, dan plugin memakai InsertService:LoadAsset — periksa di Studio.",
      });
    }),
  );
  app.get(
    "/api/projects/:id/studio/assets",
    ...assetGuard,
    rateLimit({ max: 30 }),
    wrap(async (req, res) => {
      const config = openCloudConfig(ctx.env);
      if (!config.configured)
        throw new HttpError(503, "Unggah aset ke Roblox belum dikonfigurasi.");
      const operation = String(req.query.operation || "");
      res.json({
        operation,
        ...(await operationState({ fetcher: ctx.fetcher, config }, operation)),
      });
    }),
  );
  app.post(
    "/api/studio/claim",
    rateLimit({ max: 15 }),
    plugin,
    wrap(async (req, res) => {
      const row = req.bridge,
        current = snapshotSchema.parse(req.body.snapshot);
      if (
        row.state !== "queued" ||
        row.bundle_id !== req.body.id ||
        canonical(current) !== canonical(row.snapshot)
      )
        throw new HttpError(
          409,
          "Studio berubah atau bundle tidak tersedia. Tidak ada perubahan diterapkan.",
        );
      const saved = check(
        await table()
          .update({ state: "applying" })
          .eq("token_hash", row.token_hash)
          .eq("state", "queued")
          .eq("bundle_id", req.body.id)
          .select("project_id")
          .maybeSingle(),
      );
      if (!saved) throw new HttpError(409, "Bundle sudah diambil.");
      res.json({ claimed: true });
    }),
  );
  app.post(
    "/api/studio/ack",
    rateLimit({ max: 15 }),
    plugin,
    wrap(async (req, res) => {
      if (typeof req.body.ok !== "boolean")
        throw new HttpError(400, "Receipt tidak valid.");
      const row = req.bridge;
      const receipt = {
        id: req.body.id,
        ok: req.body.ok,
        at: new Date().toISOString(),
      };
      const saved = check(
        await table()
          .update({ state: req.body.ok ? "applied" : "failed", receipt })
          .eq("token_hash", row.token_hash)
          .eq("bundle_id", req.body.id)
          .eq("state", "applying")
          .select("project_id")
          .maybeSingle(),
      );
      if (!saved)
        throw new HttpError(
          409,
          "Receipt tidak cocok. Jangan menerapkan ulang.",
        );
      res.json({ recorded: true });
    }),
  );
}
