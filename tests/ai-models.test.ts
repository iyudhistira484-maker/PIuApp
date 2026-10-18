import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticTier,
  groupModels,
  listProviderModels,
  modelCatalog,
  modelCosts,
  providerLabel,
  resetModelCache,
  resolveAiModel,
  tierCosts,
  tierModels,
  tierOfModel,
} from "../server/lib/ai-models.mjs";
import { capabilities } from "../server/lib/core.mjs";
import { createApp } from "../server/app.mjs";
import { createContext } from "../server/lib/context.mjs";

// A provider key that serves several vendors at once. Nothing in the catalogue
// may drop or rewrite an id; grouping is display-only.
const served = [
  "deepseek-chat",
  "deepseek-reasoner",
  "claude-sonnet-4-20250514",
  "glm-4.6",
  "glm-4-flash",
  "qwen3-max",
  "gpt-4o-mini",
  "gemini-2.5-flash",
  "kimi-k2-0905-preview",
  "grok-4-fast",
  "mistral-large-latest",
  "llama-3.3-70b-versatile",
  "jamba-1.5-large",
];

function fixture(env: Record<string, string> = {}, models: string[] = served) {
  const calls: string[] = [];
  const ctx = {
    env: {
      LLM_API_KEY: "test-ai-private",
      LLM_BASE_URL: "https://model.test/v1",
      ...env,
    },
    fetcher: async (url: string) => {
      calls.push(url);
      return Response.json({
        data: models.map((id) => ({ id, object: "model" })),
      });
    },
  };
  return { ctx: ctx as any, calls };
}

test("model catalogue lists every id the API key serves, grouped without dropping unknown vendors", async () => {
  const { ctx } = fixture();
  const models = await listProviderModels(ctx);
  assert.deepEqual(models, [...served].sort());
  const catalog = modelCatalog(ctx.env, models);
  assert.equal(catalog.count, served.length);
  assert.deepEqual(
    catalog.groups.flatMap((g) => g.models).sort(),
    [...served].sort(),
  );
  assert.equal(providerLabel("deepseek-chat"), "DeepSeek");
  assert.equal(providerLabel("claude-sonnet-4-20250514"), "Anthropic Claude");
  assert.equal(providerLabel("glm-4.6"), "Z.ai GLM");
  assert.equal(providerLabel("qwen3-max"), "Qwen");
  assert.equal(providerLabel("jamba-1.5-large"), "Model lainnya");
  assert.equal(groupModels(served).at(-1)!.label, "Model lainnya");
  resetModelCache();
});

test("provider list is cached, shared between callers, and refreshed on demand", async () => {
  resetModelCache();
  const { ctx, calls } = fixture();
  await Promise.all([listProviderModels(ctx), listProviderModels(ctx)]);
  assert.equal(calls.length, 1);
  await listProviderModels(ctx);
  assert.equal(calls.length, 1);
  await listProviderModels(ctx, { force: true });
  assert.equal(calls.length, 2);
  resetModelCache();
});

test("LLM_MODEL is optional: the first model of the key becomes the default", async () => {
  resetModelCache();
  const { ctx } = fixture();
  const resolved = await resolveAiModel({
    ctx,
    model: "Otomatis",
    mode: "Builder",
    prompt: "pendek",
  });
  assert.equal(resolved.model, [...served].sort()[0]);
  assert.equal(resolved.tier, "Seimbang");
  assert.equal(resolved.cost, 3);
  assert.equal(automaticTier({ prompt: "x".repeat(1300) }), "Kuat");
  assert.equal(
    automaticTier({ prompt: "pendek", hasAttachments: true }),
    "Kuat",
  );
  resetModelCache();
});

test("every model the catalogue shows is priced, and the charge matches that price", async () => {
  resetModelCache();
  const env = {
    LLM_API_KEY: "test-ai-private",
    LLM_BASE_URL: "https://model.test/v1",
    LLM_MODEL: "deepseek-chat",
    LLM_MODEL_KUAT: "claude-sonnet-4-20250514",
    LLM_MODEL_CEPAT: "glm-4-flash",
  };
  const { ctx } = fixture(env);
  const models = [
    "deepseek-chat",
    "deepseek-reasoner",
    "glm-4-flash",
    "claude-sonnet-4-20250514",
  ];
  const catalog = modelCatalog(env, models);
  // One entry per model, in the same order as the list the picker renders.
  assert.deepEqual(
    catalog.costs.map((entry: any) => entry.model),
    models,
  );
  assert.deepEqual(modelCosts(env, models), catalog.costs);
  assert.deepEqual(tierCosts(), { Cepat: 1, Seimbang: 3, Kuat: 8 });
  assert.equal(catalog.tierCosts.Kuat, 8);
  // Ask and Plan are flat, whichever model answered; chat follows the tier the
  // model bills as, and the operator override moves the price with the model.
  assert.equal(catalog.askCost, 1);
  assert.equal(catalog.planCost, 2);
  for (const entry of catalog.costs) {
    const chat = await resolveAiModel({
      ctx,
      model: entry.model,
      mode: "Builder",
      prompt: "ubah warna",
    });
    assert.equal(
      chat.cost,
      entry.cost,
      `${entry.model} ditagih ${entry.cost} kredit oleh server`,
    );
    assert.equal(chat.tier, entry.tier);
    for (const mode of ["Ask", "Plan"]) {
      const flat = await resolveAiModel({ ctx, model: entry.model, mode });
      assert.equal(flat.cost, mode === "Ask" ? 1 : 2);
    }
  }
  // The override is what makes claude-sonnet-4-20250514 cost 8 and glm-4-flash 1.
  assert.deepEqual(
    catalog.costs.find(
      (entry: any) => entry.model === "claude-sonnet-4-20250514",
    ),
    { model: "claude-sonnet-4-20250514", tier: "Kuat", cost: 8 },
  );
  assert.deepEqual(
    catalog.costs.find((entry: any) => entry.model === "glm-4-flash"),
    { model: "glm-4-flash", tier: "Cepat", cost: 1 },
  );
  resetModelCache();
});

test("explicit provider models are used as-is, priced as Seimbang unless the operator maps them", async () => {
  resetModelCache();
  const { ctx } = fixture({ LLM_MODEL_KUAT: "claude-sonnet-4-20250514" });
  const direct = await resolveAiModel({
    ctx,
    model: "deepseek-reasoner",
    mode: "Builder",
    prompt: "ubah warna",
  });
  assert.equal(direct.model, "deepseek-reasoner");
  assert.equal(direct.cost, 3);
  const strong = await resolveAiModel({
    ctx,
    model: "claude-sonnet-4-20250514",
    mode: "Builder",
    prompt: "ubah warna",
  });
  assert.equal(strong.model, "claude-sonnet-4-20250514");
  assert.equal(strong.tier, "Kuat");
  assert.equal(strong.cost, 8);
  assert.deepEqual(tierModels(ctx.env), { Kuat: "claude-sonnet-4-20250514" });
  assert.equal(tierOfModel("glm-4-flash", {}), "Seimbang");
  // Ask and Plan keep their flat prices whatever the model is.
  assert.equal(
    (await resolveAiModel({ ctx, model: "gpt-4o-mini", mode: "Ask" })).cost,
    1,
  );
  assert.equal(
    (await resolveAiModel({ ctx, model: "qwen3-max", mode: "Plan" })).cost,
    2,
  );
  resetModelCache();
});

test("a model the API key does not serve is refused instead of silently swapped", async () => {
  resetModelCache();
  const { ctx } = fixture();
  await assert.rejects(
    () =>
      resolveAiModel({
        ctx,
        model: "claude-opus-4",
        mode: "Builder",
        prompt: "tes",
      }),
    /tidak tersedia pada API key/,
  );
  // The tier presets still resolve through LLM_MODEL when the list is down.
  resetModelCache();
  const offline = fixture({ LLM_MODEL: "deepseek-chat" });
  offline.ctx.fetcher = async () => {
    throw new Error("network down");
  };
  const resolved = await resolveAiModel({
    ctx: offline.ctx,
    model: "Seimbang",
    mode: "Builder",
    prompt: "tes",
  });
  assert.equal(resolved.model, "deepseek-chat");
  // An explicit model is not blocked just because the list endpoint is flaky;
  // the provider stays the authority on which ids exist.
  resetModelCache();
  const passthrough = await resolveAiModel({
    ctx: offline.ctx,
    model: "glm-4.6",
    mode: "Builder",
    prompt: "tes",
  });
  assert.equal(passthrough.model, "glm-4.6");
  // Without LLM_MODEL and without a readable list, it fails closed.
  resetModelCache();
  const bare = fixture();
  bare.ctx.fetcher = async () => {
    throw new Error("network down");
  };
  await assert.rejects(
    () => resolveAiModel({ ctx: bare.ctx, model: "Otomatis", mode: "Builder" }),
    /Default model AI belum ditentukan/,
  );
  resetModelCache();
});

test("an empty or rejecting provider list is reported, not treated as success", async () => {
  resetModelCache();
  const empty = fixture({}, []);
  await assert.rejects(
    () => listProviderModels(empty.ctx),
    /daftar model kosong/,
  );
  const rejected = fixture();
  rejected.ctx.fetcher = async () => new Response("nope", { status: 401 });
  await assert.rejects(
    () => listProviderModels(rejected.ctx),
    /menolak permintaan/,
  );
  resetModelCache();
});

test("AI capability no longer requires LLM_MODEL, but still needs key and base URL", () => {
  const base = {
    VITE_SUPABASE_URL: "https://example.test",
    VITE_SUPABASE_ANON_KEY: "test-public",
    SUPABASE_SERVICE_ROLE_KEY: "test-private",
    LLM_API_KEY: "test-ai-private",
    LLM_BASE_URL: "https://model.test/v1",
  };
  assert.equal(capabilities(base).ai, true);
  assert.equal(capabilities({ ...base, LLM_MODEL: "deepseek-chat" }).ai, true);
  assert.equal(capabilities({ ...base, LLM_API_KEY: "" }).ai, false);
  assert.equal(capabilities({ ...base, LLM_BASE_URL: "" }).ai, false);
  assert.equal(
    capabilities({ ...base, SUPABASE_SERVICE_ROLE_KEY: "" }).ai,
    false,
  );
});

test("GET /api/ai/models exposes the provider catalogue and never leaks the key", async () => {
  resetModelCache();
  const { ctx } = fixture({
    VITE_SUPABASE_URL: "https://example.test",
    VITE_SUPABASE_ANON_KEY: "test-public",
    SUPABASE_SERVICE_ROLE_KEY: "test-private",
  });
  const { app } = createApp({
    env: ctx.env,
    context: createContext(ctx.env, ctx.fetcher) as any,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((ready) => server.once("listening", ready));
  const port = (server.address() as any).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ai/models`);
    const body: any = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.models, [...served].sort());
    assert.ok(body.groups.some((g: any) => g.label === "DeepSeek"));
    assert.ok(body.groups.some((g: any) => g.label === "Anthropic Claude"));
    assert.ok(body.groups.some((g: any) => g.label === "Z.ai GLM"));
    assert.equal(body.defaultModel, [...served].sort()[0]);
    // The page prints these prices, so they travel with the catalogue.
    assert.equal(body.costs.length, served.length);
    assert.deepEqual(body.tierCosts, { Cepat: 1, Seimbang: 3, Kuat: 8 });
    assert.equal(body.askCost, 1);
    assert.equal(body.planCost, 2);
    assert.ok(body.costs.every((entry: any) => entry.cost >= 1));
    assert.ok(!JSON.stringify(body).includes("test-ai-private"));
  } finally {
    server.close();
    resetModelCache();
  }
});
