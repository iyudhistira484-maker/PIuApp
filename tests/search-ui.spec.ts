import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// The client half of the research contract: the composer toggle really turns
// research on for the request, the numbered sources are shown like the
// citations in the answer, an invented citation number is called out instead of
// resolved, and both survive a reload. Retrieval itself is covered by
// tests/search.test.ts and tests/search-api.test.ts.
const sources = [
  {
    index: 1,
    provider: "tavily",
    kind: "web",
    title: "Dokumentasi resmi",
    url: "https://dokumen.example.test/panduan",
    snippet: "Cuplikan pertama",
    query: "next.js app router retry",
  },
  {
    index: 2,
    provider: "tavily",
    kind: "web",
    title: "Artikel kedua",
    url: "https://kedua.example.test/tulis",
    snippet: "Cuplikan kedua",
    query: "error handling app router",
  },
];
const research = {
  rounds: [
    {
      query: "next.js app router retry",
      kind: "web",
      provider: "tavily",
      label: "Tavily",
      cached: false,
      count: 2,
      error: "",
    },
  ],
  sources,
  read: 2,
  notice: "2 sumber dari 1 pencarian. Isinya data tidak tepercaya.",
  cited: [1],
  uncited: [2],
  invalid: [7],
  citationNotice: "",
  checked: 1,
  unsupported: [2],
  insufficient: [],
  groundingNotice:
    "Pemeriksaan heuristik: sitasi 2 tidak berbagi satu kata pun dengan isi sumbernya. Periksa ulang sebelum dipercaya.",
};

async function fixture(page: Page) {
  await realAccountFixture(page);
  const body = { value: null as any };
  await page.route("**/api/projects/*/ai", async (r) => {
    Object.assign(body, { value: r.request().postDataJSON() });
    const prompt = r.request().postDataJSON().prompt as string;
    const result: any = {
      content: "Respons API pengujian diterima.",
      creditsUsed: 1,
    };
    if (/tanpa hasil/i.test(prompt)) {
      result.content = "Saya belum menemukan sumber untuk pertanyaan itu.";
      result.research = {
        ...research,
        rounds: [
          {
            query: "topik langka",
            kind: "web",
            provider: "",
            label: "",
            cached: false,
            count: 0,
            error:
              "Pencarian web belum dikonfigurasi. Isi SEARCH_PROVIDER dan SEARCH_API_KEY di server.",
          },
        ],
        sources: [],
        read: 0,
        notice: "Tidak ada sumber yang berhasil diambil.",
        cited: [],
        uncited: [],
        invalid: [],
        citationNotice: "Jawaban tidak mengutip nomor sumber mana pun.",
      };
    } else if (/retry/i.test(prompt)) {
      result.content = "Pakai pengulangan berjenjang [1], dan catat [7].";
      result.sources = sources;
      result.research = research;
      result.creditsUsed = 2;
    } else if (/ringkasan/i.test(prompt)) {
      // A cross-page synthesis: the panel must say it is a model artifact, not a
      // quote, and must mark the citations only the synthesis backs.
      result.content =
        "Kedua halaman sepakat [1], dan rinciannya hanya di ringkasan [2].";
      result.sources = sources;
      result.research = {
        ...research,
        cited: [1, 2],
        uncited: [],
        unsupported: [],
        groundingNotice:
          "Sitasi 2 hanya didukung ringkasan AI, bukan kata-kata halaman sumbernya — periksa ulang bila penting.",
        viaSummary: [2],
        summary: {
          text: "Kedua halaman menekankan pengulangan berjenjang dan pencatatan kegagalan.",
          covers: [1, 2],
          cited: [1, 2],
          invalid: [],
          gaps: "Tidak ada sumber soal biaya.",
          notice:
            "Tautan yang bukan salah satu sumber dihapus dari ringkasan: https://jahat.test/z.",
          pages: 2,
          round: 1,
        },
      };
      result.creditsUsed = 2;
    } else if (/daftar berkas/i.test(prompt)) {
      // An ordinary turn that used the read-only server tools.
      result.content = "Berkas project sudah saya daftar.";
      result.tools = {
        rounds: 1,
        calls: [
          { name: "list_files", ok: true },
          { name: "read_file", ok: false },
        ],
        refused: ["read_file"],
        notice:
          "1 ronde alat server (list_files, read_file); hanya membaca berkas project — tanpa kredit, tanpa jaringan.",
      };
      result.notes = [
        "Argumen tool read_file tidak lengkap atau bukan JSON yang sah; tidak ada yang dijalankan.",
      ];
    }
    return r.fulfill({
      contentType: "text/event-stream",
      // A step event travels before the answer, exactly like the real loop, so
      // the client is proven to tolerate progress lines mid-stream.
      body:
        `data: ${JSON.stringify({
          type: "step",
          step: {
            phase: "search",
            round: 1,
            queries: ["retry next.js"],
          },
        })}\n\n` + `data: ${JSON.stringify({ type: "result", result })}\n\n`,
    });
  });
  return body;
}

// The composer refuses a follow-up while a sync is still running, so every
// send waits for the workspace to report a synced state first.
async function waitSynced(page: Page) {
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  await waitSynced(page);
  await page.getByLabel("Pesan untuk AI").fill(text);
  await page.getByRole("button", { name: "Kirim pesan" }).click();
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0);
}

async function openProject(page: Page) {
  await page.goto("/");
  await page
    .getByPlaceholder("Minta PiwuApp membuat aplikasi tentang…")
    .fill("Buat website studio desain");
  await page
    .getByRole("button", { name: "Kirim ide dan buat project" })
    .click();
  await loginRealFixture(page);
  await expect(page.getByText("Respons API pengujian diterima.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
}

test("the research toggle is off by default, persists and is sent as research:true", async ({
  page,
}) => {
  const body = await fixture(page);
  await openProject(page);
  const toggle = page.getByRole("button", { name: "Mode riset" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // A plain turn must not ask the server to search.
  await sendMessage(page, "Geser atap dua stud ke kanan");
  await expect(page.getByText("Respons API pengujian diterima.")).toHaveCount(
    2,
  );
  expect(body.value.research).toBe(false);
  await expect(page.locator(".ai-sources")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await sendMessage(page, "Cara retry di Next.js App Router?");
  await expect(page.locator(".ai-sources")).toHaveCount(1);
  expect(body.value.research).toBe(true);
  // The preference is per account and survives a reload.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Mode riset" }),
  ).toHaveAttribute("aria-pressed", "true");
});

// A run that is still going when the user comes back is reported as running and
// collected without a reload — that is why the job store exists.
test("a research turn still running is shown, then collected by itself", async ({
  page,
}) => {
  await fixture(page);
  const requestId = "b41f7c6d-2222-4333-8444-555566667777";
  const base = {
    requestId,
    prompt: "Riset latar belakang soal retry",
    mode: "Ask",
    model: "deepseek-chat",
    startedAt: Date.now() - 5000,
    creditsUsed: 0,
    error: "",
  };
  const ready = {
    ...base,
    state: "ready",
    finishedAt: Date.now(),
    creditsUsed: 2,
    result: {
      content: "Pakai pengulangan berjenjang [1].",
      creditsUsed: 2,
      sources,
      research,
      model: "deepseek-chat",
      tier: "Seimbang",
    },
  };
  let listed = 0;
  await page.route(/\/api\/projects\/[^/]+\/ai\/jobs(\/[^/]+)?$/, async (r) => {
    if (r.request().method() === "DELETE")
      return r.fulfill({ json: { job: ready } });
    listed += 1;
    // Still running for the first checks, so the honest "still running" state is
    // observable, then finished: the answer must appear on its own.
    return r.fulfill({
      json: { jobs: listed <= 2 ? [{ ...base, state: "running" }] : [ready] },
    });
  });
  await openProject(page);
  // Honest while it runs: the composer says the work continues on the server.
  await expect(
    page.getByText(/Riset latar belakang masih berjalan di server/),
  ).toBeVisible();
  // Then it lands in the chat on its own, without a reload.
  await expect(page.getByText("Pakai pengulangan berjenjang [1].")).toBeVisible(
    {
      timeout: 30000,
    },
  );
  await expect(
    page.getByText(/Riset latar belakang masih berjalan di server/),
  ).toHaveCount(0);
});

// Research that finished while the tab was closed: the workspace collects the
// stored answer once, shows it like a normal reply, and never applies it twice.
test("a background research answer is collected once when the project is opened", async ({
  page,
}) => {
  await fixture(page);
  const requestId = "8d2b0a3e-1111-4222-8333-444455556666";
  const job = {
    requestId,
    state: "ready",
    prompt: "Riset latar belakang soal retry",
    mode: "Ask",
    model: "deepseek-chat",
    startedAt: Date.now() - 60000,
    finishedAt: Date.now() - 50000,
    creditsUsed: 2,
    error: "",
    result: {
      content: "Pakai pengulangan berjenjang [1], dan catat [7].",
      creditsUsed: 2,
      sources,
      research,
      model: "deepseek-chat",
      tier: "Seimbang",
    },
  };
  const claimed: string[] = [];
  let waiting = [job];
  await page.route(/\/api\/projects\/[^/]+\/ai\/jobs(\/[^/]+)?$/, async (r) => {
    if (r.request().method() === "DELETE") {
      claimed.push(new URL(r.request().url()).pathname);
      waiting = [];
      return r.fulfill({ json: { job } });
    }
    return r.fulfill({ json: { jobs: waiting } });
  });
  await openProject(page);
  await expect(
    page.getByText("Pakai pengulangan berjenjang [1], dan catat [7]."),
  ).toBeVisible();
  const panel = page.locator(".ai-sources").last();
  await expect(panel.locator(".sources-headline")).toHaveText(
    "Sumber · 2 dari 1 pencarian",
  );
  // The user is told where the answer came from and what it cost.
  await expect(page.getByRole("status")).toContainText(
    "Riset yang Anda tinggalkan selesai di latar belakang",
  );
  await expect(page.getByRole("status")).toContainText(
    "Kredit ronde yang selesai tetap terpakai",
  );
  expect(claimed).toHaveLength(1);
  expect(claimed[0]).toContain(requestId);

  // A reload finds nothing left to collect, so the answer is not repeated.
  await page.reload();
  await expect(
    page.getByText("Pakai pengulangan berjenjang [1], dan catat [7]."),
  ).toHaveCount(1);
  expect(claimed).toHaveLength(1);
});

test("a round that found nothing says so instead of showing an empty list", async ({
  page,
}) => {
  await fixture(page);
  await openProject(page);
  await page.getByRole("button", { name: "Mode riset" }).click();
  await sendMessage(page, "Cari bahan tentang topik langka tanpa hasil");
  const panel = page.locator(".ai-sources").last();
  await expect(panel.locator(".sources-headline")).toHaveText(
    "Sumber · tidak ada hasil",
  );
  await expect(panel.locator("ol")).toHaveCount(0);
  await expect(panel).toContainText("Tidak ada sumber yang berhasil diambil.");
  // The failing query carries the server's own reason, so the user can act.
  await expect(panel.locator("ul.sources-failed li")).toContainText(
    "Kueri “topik langka” gagal: Pencarian web belum dikonfigurasi.",
  );
  await expect(panel).toContainText("tidak mengutip nomor sumber mana pun");
});

test("the chat lists the numbered sources and flags an invented citation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await openProject(page);
  await page.getByRole("button", { name: "Mode riset" }).click();
  await sendMessage(page, "Cara retry di Next.js App Router?");
  const panel = page.locator(".ai-sources").last();
  await expect(panel.locator(".sources-headline")).toHaveText(
    "Sumber · 2 dari 1 pencarian",
  );
  const items = panel.locator("ol > li");
  await expect(items).toHaveCount(2);
  // Sources are numbered like the citations in the reply, and open in a new tab.
  await expect(items.nth(0).locator("a")).toHaveAttribute(
    "href",
    "https://dokumen.example.test/panduan",
  );
  await expect(items.nth(0).locator("a")).toHaveAttribute("target", "_blank");
  await expect(items.nth(0).locator("a")).toContainText("Dokumentasi resmi");
  await expect(items.nth(0)).toContainText("dikutip");
  await expect(items.nth(1)).toContainText("tidak dikutip");
  // Two queries in one round: each row says which query found it.
  await expect(items.nth(0)).toContainText("kueri “next.js app router retry”");
  await expect(items.nth(1)).toContainText("kueri “error handling app router”");
  // The grounding heuristic is spoken plainly, never as "verified".
  await expect(panel).toContainText("Pemeriksaan heuristik");
  await expect(panel).not.toContainText("terverifikasi");
  await expect(items.nth(0)).toContainText("Cuplikan pertama");
  await expect(panel).toContainText("data tidak tepercaya");
  // A citation number the server never returned is reported, never resolved.
  await expect(
    panel.locator("small.warn", { hasText: "tidak pernah dikembalikan" }),
  ).toContainText("Nomor sumber yang tidak pernah dikembalikan: 7");
  // Folding works, and the report is kept with the answer.
  await panel.locator(".sources-headline").click();
  await expect(page.locator(".ai-sources").last().locator("ol")).toHaveCount(0);
  await page.reload();
  await expect(
    page.locator(".ai-sources").last().locator(".sources-headline"),
  ).toHaveText("Sumber · 2 dari 1 pencarian");
  expect(errors).toEqual([]);
});

// A run whose process died before the answer was finished cannot be recovered
// (only finished answers survive a restart), so this is said once instead of
// leaving the user waiting for an answer that will never arrive.
test("a run the server no longer knows about is reported honestly", async ({
  page,
}) => {
  await fixture(page);
  await page.route(/\/api\/projects\/[^/]+\/ai\/jobs(\/[^/]+)?$/, (r) =>
    r.fulfill({ json: { jobs: [] } }),
  );
  await openProject(page);
  const projectId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .pop()!;
  const requestId = "5c9d1f70-3333-4444-8555-666677778888";
  // The tab that sent the question is gone; this browser still remembers it.
  await page.evaluate(
    ([scope, id]) => {
      localStorage.setItem(
        `piwu-ai-research-pending-v1:${scope}`,
        JSON.stringify([{ requestId: id, at: Date.now() - 120000 }]),
      );
    },
    [projectId, requestId] as const,
  );
  await page.reload();
  const notice = page.getByRole("status");
  await expect(notice).toContainText("tidak lagi tersedia di server");
  await expect(notice).toContainText(
    "Kredit ronde yang tidak selesai dipulihkan",
  );
  // Said once and then forgotten, so returning to the project is quiet again.
  const left = await page.evaluate(
    (scope) => localStorage.getItem(`piwu-ai-research-pending-v1:${scope}`),
    projectId,
  );
  expect(left === null || JSON.parse(left).length === 0).toBe(true);
});

test("the chat shows the cross-page synthesis as a model artifact, never as a quote", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await openProject(page);
  await page.getByRole("button", { name: "Mode riset" }).click();
  // Deliberately not the word "retry": that prompt drives the other fixture
  // branch, which is about citations rather than the synthesis.
  await sendMessage(page, "Ringkasan soal pengulangan jaringan di Next.js?");
  const panel = page.locator(".ai-sources").last();
  const summary = panel.locator(".research-summary");
  await expect(summary.locator("strong")).toHaveText(
    "Ringkasan lintas halaman",
  );
  // The label is the point: model words, not the pages' words.
  await expect(summary).toContainText(
    "bukan kutipan dan bukan kata-kata halaman",
  );
  await expect(summary).toContainText("halaman [1], [2]");
  await expect(summary).toContainText(
    "Kedua halaman menekankan pengulangan berjenjang",
  );
  await expect(summary).toContainText(
    "Belum diselesaikan sumber: Tidak ada sumber soal biaya.",
  );
  // A URL that was not a source is reported, never silently kept.
  await expect(summary.locator("small.warn")).toContainText(
    "Tautan yang bukan salah satu sumber dihapus",
  );
  // The price rule is stated where the synthesis is shown.
  await expect(summary).toContainText("tidak ada kredit tambahan");
  // And the citation it alone supports is called out as such.
  await expect(panel).toContainText(
    "Sitasi 2 didukung ringkasan AI, bukan kata-kata halaman sumbernya.",
  );
  // Nothing in the panel pretends the synthesis was verified.
  await expect(panel).not.toContainText("terverifikasi");
  await page.reload();
  // The synthesis is kept with the answer, and the panel starts folded after a
  // reload, so it is opened the way a user would open it.
  const reopened = page.locator(".ai-sources").last();
  await reopened.locator(".sources-headline").click();
  await expect(reopened.locator(".research-summary")).toContainText(
    "Ringkasan lintas halaman",
  );
  // Still labelled as a model artifact, and still not a quote.
  await expect(reopened.locator(".research-summary")).toContainText(
    "bukan kutipan dan bukan kata-kata halaman",
  );
  expect(errors).toEqual([]);
});

test("an ordinary turn reports the server tools it really ran, and the ones it refused", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await openProject(page);
  await sendMessage(page, "Daftar berkas project ini");
  const report = page.locator(".ai-tools").last();
  await expect(report).toContainText(
    "1 ronde alat server (list_files, read_file)",
  );
  await expect(report).toContainText("tanpa kredit, tanpa jaringan");
  // The refused call is named, and so is the reason it was refused.
  await expect(report).toContainText("Ditolak: read_file.");
  await expect(report.locator("ul.sources-failed li")).toContainText(
    "Argumen tool read_file tidak lengkap",
  );
  expect(errors).toEqual([]);
});
