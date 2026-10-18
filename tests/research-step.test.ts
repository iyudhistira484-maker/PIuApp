import test from "node:test";
import assert from "node:assert/strict";
import { researchStepLabel } from "../src/lib/research-step";

// The running-research line is the only feedback during a research turn, so its
// wording is asserted here instead of being trusted to a screenshot.
test("the research step label says what is happening, in Indonesian", () => {
  assert.equal(researchStepLabel(null), "");
  assert.equal(
    researchStepLabel({
      phase: "search",
      round: 1,
      queries: ["retry next.js", "backoff 2026"],
    }),
    "Mencari sumber: “retry next.js”, “backoff 2026”…",
  );
  // A search with no query text still has something honest to say.
  assert.equal(
    researchStepLabel({ phase: "search", round: 2 }),
    "Mencari sumber…",
  );
  assert.equal(
    researchStepLabel({ phase: "read", round: 1, pages: 4 }),
    "Membaca 4 halaman sumber…",
  );
  assert.equal(
    researchStepLabel({ phase: "read", round: 1, pages: 0 }),
    "Menyusun jawaban dari sumber yang sudah ada…",
  );
  assert.equal(
    researchStepLabel({
      phase: "open",
      round: 1,
      urls: ["https://contoh.example.test/a"],
    }),
    "Membuka halaman yang diminta AI…",
  );
  // Roblox: name how many Studio scripts the turn actually read.
  assert.equal(
    researchStepLabel({ phase: "studio", scripts: 5, nodes: 120 }),
    "Membaca 5 script dari Roblox Studio…",
  );
  assert.equal(
    researchStepLabel({ phase: "studio", scripts: 0, stale: true }),
    "Membaca snapshot dari Roblox Studio (snapshot lama — kirim ulang dari Studio)…",
  );
  // A phase this build does not know about must not invent a sentence.
  assert.equal(researchStepLabel({ phase: "entah" as any }), "");
});
