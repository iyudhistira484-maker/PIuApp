import { HttpError } from "./core.mjs";
import { CREDIT_COSTS } from "../../shared/credits.mjs";

// Model catalogue and model resolution.
//
// The provider configured through LLM_BASE_URL/LLM_API_KEY is the single source
// of truth: whatever GET {base}/models returns is offered to the user, grouped
// only for display. Nothing here hardcodes a provider, so an API key that
// serves DeepSeek, GLM, Claude, Qwen, or anything else shows exactly those
// models. Grouping falls back to "Model lainnya" for ids we do not recognise.

export const TIERS = ["Otomatis", "Cepat", "Seimbang", "Kuat"];
const CACHE_MS = 60000;
const cache = new Map();
const inflight = new Map();

// Cosmetic grouping hints. Unknown ids are never hidden, only listed last.
const GROUPS = [
  [/\b(deepseek|ds-)/i, "DeepSeek"],
  [/\b(claude|anthropic)/i, "Anthropic Claude"],
  [/\b(glm|zhipu|chatglm)/i, "Z.ai GLM"],
  [/\b(gpt|chatgpt|codex|^o[1-4](-|$)|text-embedding)/i, "OpenAI"],
  [/\b(gemini|gemma|palm)/i, "Google"],
  [/\b(qwen|qwq|qvq)/i, "Qwen"],
  [/\b(kimi|moonshot)/i, "Moonshot Kimi"],
  [/\b(grok|xai)/i, "xAI Grok"],
  [/\b(mistral|mixtral|codestral|magistral|devstral)/i, "Mistral"],
  [/\b(llama|meta-)/i, "Meta Llama"],
  [/\b(command|cohere|c4ai|aya)/i, "Cohere"],
  [/\b(minimax|abab)/i, "MiniMax"],
  [/\b(ernie|wenxin)/i, "Baidu ERNIE"],
  [/\b(doubao|bytedance|seed-)/i, "ByteDance"],
  [/\b(hunyuan|tencent)/i, "Tencent Hunyuan"],
  [/\b(sonar|pplx)/i, "Perplexity"],
  [/\b(solar|upstage)/i, "Upstage"],
  [/\b(nemotron|nvidia)/i, "NVIDIA"],
  [/\b(phi-|microsoft)/i, "Microsoft"],
];
const OTHER = "Model lainnya";

export function providerLabel(id) {
  const match = GROUPS.find(([pattern]) => pattern.test(id));
  return match ? match[1] : OTHER;
}

/** Stable, display-only grouping; every model id stays selectable. */
export function groupModels(models) {
  const order = [...GROUPS.map(([, label]) => label), OTHER];
  const buckets = new Map(order.map((label) => [label, []]));
  for (const id of models) buckets.get(providerLabel(id)).push(id);
  return order
    .filter((label) => buckets.get(label).length)
    .map((label) => ({ label, models: buckets.get(label) }));
}

/** Optional per-tier model overrides, e.g. LLM_MODEL_KUAT=claude-opus-4. */
export function tierModels(env) {
  const tiers = {};
  for (const tier of ["Cepat", "Seimbang", "Kuat"]) {
    const id = env["LLM_MODEL_" + tier.toUpperCase()];
    if (id) tiers[tier] = id;
  }
  return tiers;
}

/** Which tier a model id bills as. Operator overrides win; others = Seimbang. */
export function tierOfModel(model, tiers) {
  for (const tier of ["Kuat", "Seimbang", "Cepat"])
    if (tiers[tier] === model) return tier;
  return "Seimbang";
}

export function tierCost(tier) {
  return tier === "Kuat"
    ? CREDIT_COSTS.chat.Kuat
    : tier === "Cepat"
      ? CREDIT_COSTS.chat.Cepat
      : CREDIT_COSTS.chat.Seimbang;
}

export function automaticTier({ prompt = "", hasAttachments = false } = {}) {
  return prompt.length > 1200 || hasAttachments ? "Kuat" : "Seimbang";
}

/** What one chat turn costs on each tier preset, from the shared price list. */
export function tierCosts() {
  return {
    Cepat: CREDIT_COSTS.chat.Cepat,
    Seimbang: CREDIT_COSTS.chat.Seimbang,
    Kuat: CREDIT_COSTS.chat.Kuat,
  };
}

/**
 * What the server would charge for one chat turn on each model the API key
 * serves. The picker prints these numbers, so a shown price is a billed price:
 * both sides call tierOfModel/tierCost, and an operator override (LLM_MODEL_*)
 * moves the price on the model it maps, not on a copy in the UI.
 */
export function modelCosts(env, models) {
  const tiers = tierModels(env);
  return models.map((model) => {
    const tier = tierOfModel(model, tiers);
    return { model, tier, cost: tierCost(tier) };
  });
}

export function modelCatalog(env, models) {
  const tiers = tierModels(env);
  const fallback = env.LLM_MODEL || models[0] || "";
  return {
    source: "provider",
    count: models.length,
    models,
    groups: groupModels(models),
    tiers,
    // Ask/Plan prices are fixed; chat prices follow the tier the model bills as.
    costs: modelCosts(env, models),
    tierCosts: tierCosts(),
    askCost: CREDIT_COSTS.ask,
    planCost: CREDIT_COSTS.plan,
    defaultModel: fallback,
    defaultSource: env.LLM_MODEL
      ? "LLM_MODEL"
      : models.length
        ? "model pertama"
        : "",
  };
}

function normalizeModels(data) {
  const list = Array.isArray(data?.data) ? data.data : [];
  return [
    ...new Set(
      list
        .map((entry) => (typeof entry === "string" ? entry : entry?.id))
        .filter((id) => typeof id === "string" && id.trim())
        .map((id) => id.trim()),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/** GET {base}/models with a short cache so the picker stays responsive. */
export async function listProviderModels(ctx, { force = false } = {}) {
  const base = String(ctx.env.LLM_BASE_URL || "").replace(/\/$/, "");
  const key = base;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.models;
  if (force) cache.delete(key);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = (async () => {
    let response;
    try {
      response = await ctx.fetcher(base + "/models", {
        headers: { Authorization: "Bearer " + ctx.env.LLM_API_KEY },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new HttpError(503, "Provider AI tidak dapat dijangkau.");
    }
    if (!response.ok)
      throw new HttpError(502, "Provider AI menolak permintaan daftar model.");
    const models = normalizeModels(await response.json().catch(() => null));
    if (!models.length)
      throw new HttpError(
        502,
        "Provider mengembalikan daftar model kosong. Periksa API key dan base URL.",
      );
    cache.set(key, { at: Date.now(), models });
    return models;
  })();
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

export function resetModelCache() {
  cache.clear();
  inflight.clear();
}

/**
 * Resolve the model id sent to the provider, the tier it bills as, and the
 * credit cost for this request. Fails closed: an explicit model that the
 * provider list does not contain is rejected instead of silently downgraded.
 */
export async function resolveAiModel({
  ctx,
  model,
  mode,
  prompt = "",
  hasAttachments = false,
}) {
  const env = ctx.env;
  const tiers = tierModels(env);
  const tier = TIERS.includes(model)
    ? model === "Otomatis"
      ? automaticTier({ prompt, hasAttachments })
      : model
    : tierOfModel(model, tiers);
  const cost =
    mode === "Ask"
      ? CREDIT_COSTS.ask
      : mode === "Plan"
        ? CREDIT_COSTS.plan
        : tierCost(tier);
  if (!TIERS.includes(model)) {
    const models = await listProviderModels(ctx).catch(() => null);
    if (models && !models.includes(model))
      throw new HttpError(
        400,
        `Model "${model}" tidak tersedia pada API key provider ini. Pilih model dari daftar.`,
      );
    return { model, tier, cost };
  }
  if (tiers[tier]) return { model: tiers[tier], tier, cost };
  if (env.LLM_MODEL) return { model: env.LLM_MODEL, tier, cost };
  // LLM_MODEL is optional: fall back to the first model the API key offers.
  const models = await listProviderModels(ctx).catch(() => null);
  if (!models?.length)
    throw new HttpError(
      503,
      "Default model AI belum ditentukan. Isi LLM_MODEL atau pastikan daftar model provider dapat dibaca.",
    );
  return { model: models[0], tier, cost };
}
