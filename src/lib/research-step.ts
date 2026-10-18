import type { ResearchStep } from "./types";

/**
 * Plain Indonesian for the step the research loop is on, so a wait that can
 * take a minute has a reason instead of a bare spinner. Kept in the library
 * (and tested) so the wording never drifts from what the server reports.
 */
export function researchStepLabel(step: ResearchStep | null): string {
  if (!step) return "";
  if (step.phase === "search")
    return `Mencari sumber${
      step.queries?.length
        ? `: ${step.queries.map((query) => `“${query}”`).join(", ")}`
        : ""
    }…`;
  if (step.phase === "open") return "Membuka halaman yang diminta AI…";
  if (step.phase === "read")
    return step.pages
      ? `Membaca ${step.pages} halaman sumber…`
      : "Menyusun jawaban dari sumber yang sudah ada…";
  // The read-only server tools run in every mode, so the label may not assume
  // research: it names exactly the tools the server ran.
  if (step.phase === "tool")
    return `Menjalankan alat server: ${
      step.tools?.length ? step.tools.join(", ") : "berkas project"
    }…`;
  if (step.phase === "summary")
    return `Menyusun ringkasan lintas halaman dari ${
      step.pages ? `${step.pages} halaman` : "halaman yang terbaca"
    }…`;
  // Roblox: the server read the latest snapshot sent by the Studio plugin, so
  // the answer is based on the place being built, not only imported files.
  if (step.phase === "studio")
    return `Membaca ${
      step.scripts ? `${step.scripts} script` : "snapshot"
    } dari Roblox Studio${step.stale ? " (snapshot lama — kirim ulang dari Studio)" : ""}…`;
  return "";
}
