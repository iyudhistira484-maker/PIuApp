/**
 * Project quality, read from the audits the user already ran. The server stores
 * each Lighthouse run in `scan_reports` (`score` + the whole report), so a score
 * and its movement are derivable without storing anything new.
 */
export interface AuditReport {
  id?: string;
  type?: string;
  score?: number | null;
  created_at?: string;
  /** The full report: `{ scores: {...}, findings: [...] }`. */
  findings?: unknown;
}

export interface Quality {
  /** Newest numeric score, or null when there is no usable report. */
  latest: number | null;
  previous: number | null;
  /** latest - previous, when both exist. */
  delta: number | null;
  at?: string;
  label: string;
  tone: "ok" | "wait" | "warn" | "none";
  /** Sub-scores the audit reported (performa, aksesibilitas, …). */
  parts: { key: string; score: number }[];
  findings: number;
}

const PART_LABELS: Record<string, string> = {
  performance: "Performa",
  accessibility: "Aksesibilitas",
  "best-practices": "Praktik",
  seo: "SEO",
};

export function qualityOf(reports: AuditReport[] | undefined): Quality {
  const rows = (reports || [])
    .filter((report) => typeof report.score === "number")
    .sort(
      (a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""),
    );
  const empty: Quality = {
    latest: null,
    previous: null,
    delta: null,
    label: "Belum pernah diaudit",
    tone: "none",
    parts: [],
    findings: 0,
  };
  if (!rows.length) return empty;
  const latest = Number(rows[0].score);
  const previous =
    rows.length > 1 && typeof rows[1].score === "number"
      ? Number(rows[1].score)
      : null;
  const report = rows[0].findings as
    { scores?: Record<string, unknown>; findings?: unknown[] } | undefined;
  const scores = report?.scores || {};
  return {
    latest,
    previous,
    delta: previous === null ? null : latest - previous,
    at: rows[0].created_at,
    label: scoreLabel(latest),
    tone: scoreTone(latest),
    parts: Object.entries(scores)
      .filter(([, score]) => typeof score === "number")
      .map(([key, score]) => ({
        key: PART_LABELS[key] || key,
        score: Math.round(Number(score)),
      })),
    findings: Array.isArray(report?.findings) ? report.findings.length : 0,
  };
}

export const scoreTone = (score: number): Quality["tone"] =>
  score >= 90 ? "ok" : score >= 70 ? "wait" : "warn";

export const scoreLabel = (score: number) =>
  score >= 90 ? "Bagus" : score >= 70 ? "Perlu diperbaiki" : "Bermasalah";

/** "naik 6 poin", "turun 4 poin", "sama" — or nothing when there is no history. */
export function trendText(quality: Quality) {
  if (quality.delta === null) return "";
  if (quality.delta === 0)
    return quality.previous === null ? "" : "sama dengan audit sebelumnya";
  const arrow = quality.delta > 0 ? "naik" : "turun";
  return `${arrow} ${Math.abs(quality.delta)} poin dari audit sebelumnya`;
}
