import type { Attachment } from "../services/api";
import type { PhotoPalette } from "./photo-palette";
import type {
  Mode,
  Model,
  OpsReport,
  Plan,
  SourceRef,
  ResearchReport,
  ResearchStep,
  ToolReport,
} from "./types";
import { supabase } from "./supabase";
import { useStore } from "./store";
export interface AIResult {
  content: string;
  plan?: Plan;
  creditsUsed?: number;
  files?: Record<string, string>;
  summary?: string[];
  /** Model the provider actually answered with, plus the tier it billed as. */
  model?: string;
  tier?: string;
  /** Present only when the reply asked for deterministic scene edits. */
  ops?: OpsReport;
  /** Numbered sources plus the citation report, when research mode ran. */
  sources?: SourceRef[];
  research?: ResearchReport;
  /** Read-only server tools that ran, with what they answered. */
  tools?: ToolReport;
  /** Honest notes for turns without a research report. */
  notes?: string[];
}

/** Tier presets; any other value is a concrete model id from the API key. */
export const AI_TIERS = ["Otomatis", "Cepat", "Seimbang", "Kuat"] as const;
export const TIER_INFO: Record<string, string> = {
  Otomatis: "Pilih sendiri: ringan untuk obrolan, kuat untuk permintaan besar",
  Cepat: "Jawaban tercepat untuk pertanyaan ringan",
  Seimbang: "Seimbang antara kecepatan dan kualitas",
  Kuat: "Paling teliti untuk perubahan besar",
};
export interface AiModelGroup {
  label: string;
  models: string[];
}
export interface AiModelCost {
  model: string;
  tier: string;
  /** Credits one chat turn on this model costs (Ask/Plan override this). */
  cost: number;
}
export interface AiModelCatalog {
  source: "provider";
  count: number;
  models: string[];
  groups: AiModelGroup[];
  /** Optional per-tier overrides the operator configured on the server. */
  tiers: Record<string, string>;
  /** What the server bills per model, aligned with `models`. */
  costs?: AiModelCost[];
  /** Chat price of each tier preset. */
  tierCosts?: Record<string, number>;
  askCost?: number;
  planCost?: number;
  defaultModel: string;
  defaultSource: string;
}
export function tierCost(tier: string) {
  return tier === "Kuat" ? 8 : tier === "Cepat" ? 1 : 3;
}
export function tierOfModel(model: string, tiers: Record<string, string> = {}) {
  for (const tier of ["Kuat", "Seimbang", "Cepat"])
    if (tiers[tier] === model) return tier;
  return "Seimbang";
}
/**
 * The credits one chat turn costs on a model. The server's catalogue is the
 * source: `costs` says exactly what it will charge, and the tier rules only
 * fill in before the catalogue has loaded (or for an id the key no longer
 * serves). Ask and Plan are fixed by the shared price list and never change
 * with the model, so the picker says so instead of printing a chat price.
 */
export function modelCost({
  model,
  catalog,
  tiers,
}: {
  model: string;
  catalog?: AiModelCatalog | null;
  tiers?: Record<string, string>;
}): { tier: string; cost: number; known: boolean } {
  const listed = catalog?.costs?.find((entry) => entry.model === model);
  if (listed) return { tier: listed.tier, cost: listed.cost, known: true };
  const map = tiers || catalog?.tiers || {};
  const tier = (AI_TIERS as readonly string[]).includes(model)
    ? model === "Otomatis"
      ? "Seimbang"
      : model
    : tierOfModel(model, map);
  const cost =
    catalog?.tierCosts?.[tier] ??
    (tier === "Otomatis" ? tierCost("Seimbang") : tierCost(tier));
  return { tier, cost, known: false };
}
/** Client mirror of the server cost rule, so the estimate never lies. */
export function estimateCredits({
  mode,
  model,
  tiers = {},
  catalog,
  prompt = "",
  hasAttachments = false,
}: {
  mode: Mode;
  model: string;
  tiers?: Record<string, string>;
  catalog?: AiModelCatalog | null;
  prompt?: string;
  hasAttachments?: boolean;
}) {
  if (mode === "Ask") return catalog?.askCost ?? 1;
  if (mode === "Plan") return catalog?.planCost ?? 2;
  // "Otomatis" is the one choice whose price depends on the prompt, because the
  // tier is picked from the prompt; every explicit model is priced as listed.
  if (model === "Otomatis" && !catalog?.costs?.some((e) => e.model === model)) {
    const tier = prompt.length > 1200 || hasAttachments ? "Kuat" : "Seimbang";
    return catalog?.tierCosts?.[tier] ?? tierCost(tier);
  }
  return modelCost({ model, catalog, tiers }).cost;
}
/**
 * Every model the configured API key serves, straight from the provider.
 * Throws with the server message when the list cannot be read; the tier
 * presets keep working in that case.
 */
export async function fetchAiModels({
  refresh = false,
  signal,
}: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<AiModelCatalog> {
  const response = await fetch(
    "/api/ai/models" + (refresh ? "?refresh=1" : ""),
    { signal },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.models))
    throw new Error(
      data.error ||
        "Daftar model provider tidak dapat dibaca. Tier Otomatis/Cepat/Seimbang/Kuat tetap tersedia.",
    );
  return data as AiModelCatalog;
}
/** Session headers, or null when the account is not a verified one. */
async function verifiedHeaders(): Promise<Record<string, string> | null> {
  const session = supabase
    ? (await supabase.auth.getSession()).data.session
    : null;
  const user = useStore.getState().user;
  if (!session || !user || user.demo || session.user.id !== user.id)
    return null;
  return { Authorization: "Bearer " + session.access_token };
}

export interface ResearchJob {
  requestId: string;
  state: "running" | "ready" | "failed";
  prompt: string;
  mode: string;
  model: string;
  startedAt: number;
  finishedAt: number;
  creditsUsed: number;
  error: string;
  result?: AIResult;
}

/**
 * Research that finished after the tab closed, waiting for this account and
 * project to collect it. A failure here is not worth breaking the workspace
 * over: the job simply stays until the next attempt.
 */
export async function fetchResearchJobs(
  projectId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ResearchJob[]> {
  const headers = await verifiedHeaders();
  if (!headers) return [];
  const response = await fetch("/api/projects/" + projectId + "/ai/jobs", {
    headers,
    signal,
  }).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.jobs) ? (data.jobs as ResearchJob[]) : [];
}

/** Takes a finished job exactly once, so an answer is never applied twice. */
export async function claimResearchJob(
  projectId: string,
  requestId: string,
): Promise<ResearchJob | null> {
  const headers = await verifiedHeaders();
  if (!headers) return null;
  const response = await fetch(
    "/api/projects/" + projectId + "/ai/jobs/" + requestId,
    { method: "DELETE", headers },
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => ({}));
  return (data.job as ResearchJob) || null;
}

export async function streamAI({
  projectId,
  attachments,
  photoPalettes,
  references,
  prompt,
  files,
  mode,
  model,
  research = false,
  requestId,
  onToken,
  onStep,
  signal,
}: {
  projectId: string;
  attachments?: Attachment[];
  /** Sampled colour grids, one slot per attached photo (null when sampling failed). */
  photoPalettes?: (PhotoPalette | null)[];
  references?: string[];
  prompt: string;
  files: Record<string, string>;
  mode: Mode;
  model: string;
  /** Opt-in: the reply may run one bounded search round and cite sources. */
  research?: boolean;
  /** Caller-owned id: the same id claims the background job after delivery. */
  requestId?: string;
  onToken: (s: string) => void;
  /** What the research loop is doing right now, so the wait is explainable. */
  onStep?: (step: ResearchStep) => void;
  signal?: AbortSignal;
}): Promise<AIResult> {
  const headers = await verifiedHeaders();
  if (!headers)
    throw new Error("Masuk dengan akun terverifikasi untuk menjalankan AI.");
  const accountId = useStore.getState().user!.id;
  const response = await fetch("/api/projects/" + projectId + "/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      requestId: requestId || crypto.randomUUID(),
      prompt,
      files,
      mode,
      model,
      attachments,
      references,
      research,
      ...(photoPalettes?.length ? { photoPalettes } : {}),
    }),
    signal,
  });
  if (!response.ok) {
    const e = await response
      .json()
      .catch(() => ({ error: "Layanan AI tidak merespons." }));
    throw new Error(e.error || "Layanan tidak tersedia.");
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let result: AIResult = { content: "" };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const event = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = event
        .split("\n")
        .filter((x) => x.startsWith("data: "))
        .map((x) => x.slice(6))
        .join("\n");
      if (!data) continue;
      const p = JSON.parse(data);
      if (p.type === "token") {
        result.content += p.content;
        onToken(result.content);
      }
      if (p.type === "step") onStep?.(p.step as ResearchStep);
      if (p.type === "result") {
        result = p.result;
        completed = true;
      }
      if (p.type === "error") throw new Error(p.message);
    }
  }
  if (!completed)
    throw new Error(
      "Streaming terputus sebelum hasil lengkap. Tidak ada perubahan file yang diterapkan.",
    );
  if (useStore.getState().user?.id !== accountId)
    throw new Error("Akun berubah. Hasil AI tidak diterapkan.");
  if (mode === "Plan" && !result.plan)
    throw new Error(
      "Provider tidak mengembalikan rencana. Tidak ada rencana preset yang digunakan.",
    );
  if (mode !== "Builder") delete result.files;
  return result;
}
