import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  SEARCH_QUERIES_MAX,
  SEARCH_RESULTS_MAX,
  assertCleanSources,
  canonicalSourceKey,
  fetchSourceBodies,
  providers,
  resetSearchCache,
  resolveProvider,
  runSearch,
  searchCapability,
  searchOne,
  selectExcerpt,
  significantTerms,
} from "../server/lib/search.mjs";
import {
  FETCH_MAX_DEFAULT,
  OPENED_PROVIDER,
  READ_EXCERPT_CHARS,
  READ_SOURCES_MAX,
  SOURCES_TOTAL_MAX,
  SUMMARY_CHARS_MAX,
  SUMMARY_PAGES_MIN,
  buildResearchReport,
  citationReport,
  groundingReport,
  openResultText,
  openSources,
  parseSummary,
  readBodies,
  researchInstruction,
  researchStatus,
  researchTools,
  runSearchRound,
  searchReservationId,
  searchRoundsMax,
  sourcesPrompt,
  splitSearchOps,
  summaryEnabled,
  summaryInstruction,
  summaryPromptBlock,
  toolCallsToOps,
  toolResultText,
} from "../server/lib/research.mjs";
import { fetchReference } from "../server/lib/references.mjs";
import { cacheKey, createSearchCache } from "../server/lib/search-cache.mjs";
import { capabilities } from "../server/lib/core.mjs";

// Payloads below are the vendors' documented response shapes (verified against
// the official SDKs, MCP servers and OpenAPI documents on 2026-10-15), not what
// our own parser happens to expect — so a wrong field name fails right here.
const providerPayloads: Record<string, any> = {
  "api.tavily.com": {
    query: "cara pakai vite",
    response_time: 0.42,
    results: [
      {
        title: "Dokumentasi resmi",
        url: "https://docs.example.test/a",
        content: "Isi halaman",
        score: 0.97,
        raw_content: null,
      },
      {
        title: "Referensi kedua",
        url: "https://example.test/b",
        content: "Cuplikan",
        score: 0.81,
      },
    ],
  },
  // Exa returns highlights as a LIST of strings, plus camelCase metadata.
  "api.exa.ai": {
    requestId: "req_1",
    resolvedSearchType: "auto",
    costDollars: { total: 0.007 },
    results: [
      {
        id: "https://exa.example.test/x",
        title: "Exa hit",
        url: "https://exa.example.test/x",
        highlights: ["Bagian penting pertama.", "Bagian penting kedua."],
        highlightScores: [0.9, 0.8],
      },
    ],
  },
  // Brave nests hits under web.results and adds extra_snippets.
  "api.search.brave.com": {
    type: "search",
    web: {
      results: [
        {
          title: "Brave hit",
          url: "https://brave.example.test/y",
          description: "Deskripsi",
          extra_snippets: ["Potongan tambahan"],
        },
      ],
    },
  },
  // Parallel has no `snippet`: excerpts are a list, and title may be null.
  "api.parallel.ai": {
    search_id: "search_1",
    session_id: "session_1",
    results: [
      {
        url: "https://parallel.example.test/z",
        title: "Parallel hit",
        publish_date: "2026-01-15",
        excerpts: ["Kutipan satu", "Kutipan dua"],
      },
      {
        url: "https://parallel.example.test/tanpa-judul",
        title: null,
        publish_date: null,
        excerpts: ["Hanya cuplikan."],
      },
    ],
  },
};

/** Minimal stand-in for the service-role client, with PostgREST-shaped answers. */
function cacheAdmin(rows: Map<string, any>, { missing = false } = {}) {
  const builder: any = {
    key: "",
    select: () => builder,
    eq: (_column: string, value: string) => ((builder.key = value), builder),
    limit: () => builder,
    lt: () => builder,
    abortSignal: () => builder,
    delete: () => builder,
    upsert: async (row: any) => {
      if (missing) return { error: { code: "PGRST205", message: "missing" } };
      rows.set(row.key, row);
      return { error: null };
    },
    then: (resolve: any, reject?: any) =>
      Promise.resolve(
        missing
          ? { error: { code: "PGRST205", message: "missing" }, data: null }
          : {
              data: rows.has(builder.key) ? [rows.get(builder.key)] : [],
              error: null,
            },
      ).then(resolve, reject),
  };
  return { from: () => builder } as any;
}

/** A real (tiny) PDF, so the document path is exercised for real, not mocked. */
function pdfBytes(text: string) {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${text.length + 40} >>\nstream\nBT /F1 12 Tf 20 50 Td (${text}) Tj ET\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets)
    pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function fixture(
  env: Record<string, string> = {},
  {
    fail,
    payload,
    payloadHost = "api.tavily.com",
    retry,
  }: {
    fail?: string;
    payload?: any;
    payloadHost?: string;
    retry?: Record<string, number>;
  } = {},
) {
  const calls: string[] = [];
  // Full request log, so tests can assert the vendor contract (URL, method,
  // headers, body) and not only the parsed result.
  const requests: any[] = [];
  const ctx = {
    env: {
      SEARCH_PROVIDER: "tavily",
      SEARCH_API_KEY: "search-test-key",
      ...env,
    },
    // Backoff is real in production; tests keep it at zero so the suite stays fast.
    searchRetry: { baseMs: 0, ...(retry || {}) },
    fetcher: async (input: any, init: any = {}) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      calls.push(url.host + url.pathname + (url.search || ""));
      requests.push({
        url: url.href,
        method: init.method || "GET",
        headers: Object.fromEntries(
          Object.entries(init.headers || {}).map(([key, value]) => [
            key.toLowerCase(),
            String(value),
          ]),
        ),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (fail && url.pathname.includes(fail))
        return new Response("nope", { status: 500 });
      // Lets one test hand a provider response with markup in it.
      if (payload && url.host === payloadHost) return Response.json(payload);
      if (providerPayloads[url.host])
        return Response.json(providerPayloads[url.host]);
      // Nothing keyless is left to fake: every host here must be a paid vendor.
      throw new Error("Unexpected search fixture: " + url.href);
    },
  };
  return { ctx: ctx as any, calls, requests };
}

test("web search normalizes every provider to one source shape", async () => {
  for (const provider of ["tavily", "exa", "brave", "parallel"]) {
    resetSearchCache();
    const { ctx } = fixture({ SEARCH_PROVIDER: provider });
    const result = await searchOne(ctx, {
      query: "cara pakai vite",
      kind: "web",
    });
    assert.equal(result.provider, provider, provider);
    assert.ok(result.sources.length >= 1, provider);
    for (const source of result.sources) {
      assert.match(source.url, /^https:\/\//, provider);
      assert.equal(source.kind, "web");
      assert.equal(source.provider, provider);
      assert.ok(source.title.length > 0 && source.title.length <= 160);
      assert.ok(source.snippet.length > 0, provider + " snippet");
      assert.ok(source.snippet.length <= 320);
    }
  }
});

test("each web provider is called the way its vendor documents the API", async () => {
  const expected: Record<
    string,
    { url: string; method: string; header: [string, string]; body?: any }
  > = {
    tavily: {
      url: "https://api.tavily.com/search",
      method: "POST",
      // The official SDK sends the key as a bearer token only, never in the body.
      header: ["authorization", "Bearer search-test-key"],
      body: {
        query: "kontrak",
        max_results: SEARCH_RESULTS_MAX,
        search_depth: "basic",
        include_answer: false,
      },
    },
    exa: {
      url: "https://api.exa.ai/search",
      method: "POST",
      header: ["x-api-key", "search-test-key"],
      body: {
        query: "kontrak",
        numResults: SEARCH_RESULTS_MAX,
        type: "auto",
        // Without an explicit contents block Exa returns no page text at all.
        contents: { highlights: true },
      },
    },
    brave: {
      url:
        "https://api.search.brave.com/res/v1/web/search?count=" +
        SEARCH_RESULTS_MAX +
        "&q=kontrak",
      method: "GET",
      header: ["x-subscription-token", "search-test-key"],
    },
    parallel: {
      url: "https://api.parallel.ai/v1/search",
      method: "POST",
      header: ["x-api-key", "search-test-key"],
      // `search_queries` is a required field in the vendor's schema.
      body: {
        objective: "kontrak",
        search_queries: ["kontrak"],
        mode: "basic",
        max_chars_total: 6000,
      },
    },
  };
  for (const [provider, want] of Object.entries(expected)) {
    resetSearchCache();
    const { ctx, requests } = fixture({ SEARCH_PROVIDER: provider });
    await searchOne(ctx, { query: "kontrak", kind: "web" });
    const request = requests.at(-1);
    assert.equal(request.url, want.url, provider + " url");
    assert.equal(request.method, want.method, provider + " method");
    assert.equal(request.headers[want.header[0]], want.header[1], provider);
    assert.equal(
      request.headers["content-type"],
      want.method === "POST" ? "application/json" : undefined,
      provider + " content-type",
    );
    if (want.body)
      assert.deepEqual(request.body, want.body, provider + " body");
    else assert.equal(request.body, undefined, provider + " body");
  }
});

test("every provider payload is read the way its vendor documents it", async () => {
  // Exa: highlights are a list, so they have to be joined into one snippet.
  resetSearchCache();
  const exa = await searchOne(fixture({ SEARCH_PROVIDER: "exa" }).ctx, {
    query: "cara pakai vite",
    kind: "web",
  });
  assert.equal(
    exa.sources[0].snippet,
    "Bagian penting pertama. Bagian penting kedua.",
  );
  // When Exa returns full text, that wins over the highlights.
  const withText = fixture(
    { SEARCH_PROVIDER: "exa" },
    {
      payloadHost: "api.exa.ai",
      payload: {
        results: [
          {
            id: "https://exa.example.test/t",
            title: "",
            url: "https://exa.example.test/t",
            text: "Teks penuh halaman",
            highlights: ["Sorotan"],
          },
        ],
      },
    },
  );
  const textFirst = await searchOne(withText.ctx, {
    query: "teks penuh",
    kind: "web",
  });
  assert.equal(textFirst.sources[0].snippet, "Teks penuh halaman");
  // An empty title falls back to the host instead of an empty row.
  assert.equal(textFirst.sources[0].title, "exa.example.test");

  // Brave: description normally wins, extra_snippets covers an empty one.
  resetSearchCache();
  const brave = fixture(
    { SEARCH_PROVIDER: "brave" },
    {
      payloadHost: "api.search.brave.com",
      payload: {
        web: {
          results: [
            {
              title: "Brave tanpa deskripsi",
              url: "https://brave.example.test/kosong",
              description: "",
              extra_snippets: ["Potongan satu", "Potongan dua"],
            },
          ],
        },
      },
    },
  );
  const fromExtra = await searchOne(brave.ctx, {
    query: "brave",
    kind: "web",
  });
  assert.equal(fromExtra.sources[0].snippet, "Potongan satu Potongan dua");

  // Parallel: excerpts are a list and title may be null.
  resetSearchCache();
  const parallel = await searchOne(
    fixture({ SEARCH_PROVIDER: "parallel" }).ctx,
    {
      query: "cara pakai vite",
      kind: "web",
    },
  );
  assert.equal(parallel.sources[0].snippet, "Kutipan satu Kutipan dua");
  assert.equal(parallel.sources[1].title, "parallel.example.test");
  assert.equal(parallel.sources[1].snippet, "Hanya cuplikan.");

  // Nothing but the normalized fields ever reaches the prompt: vendor extras
  // such as Tavily's relevance score are dropped here.
  resetSearchCache();
  const tavily = await searchOne(fixture().ctx, {
    query: "cara pakai vite",
    kind: "web",
  });
  assert.deepEqual(Object.keys(tavily.sources[0]).sort(), [
    "kind",
    "provider",
    "snippet",
    "title",
    "url",
  ]);
});

test("a provider that returns a private or plain-http URL is dropped, not fetched", async () => {
  const { ctx } = fixture();
  ctx.fetcher = async () =>
    Response.json({
      results: [
        { title: "internal", url: "http://10.0.0.5/admin", content: "rahasia" },
        {
          title: "metadata service",
          url: "http://169.254.169.254/latest/meta-data",
          content: "kredensial",
        },
        { title: "aman", url: "https://contoh.test/dokumen", content: "ok" },
      ],
    });
  const result = await searchOne(ctx, { query: "apa saja", kind: "web" });
  assert.deepEqual(
    result.sources.map((s: any) => s.url),
    ["https://contoh.test/dokumen"],
  );
});

test("provider text is stripped of control characters before it reaches a prompt", async () => {
  const { ctx } = fixture();
  ctx.fetcher = async () =>
    Response.json({
      results: [
        {
          title: "Judul\u0000dengan\u001b[31mkontrol",
          url: "https://contoh.test/x",
          content: "Cuplikan\u0007dengan\u0000nul\n\n baris   baru",
        },
      ],
    });
  const result = await searchOne(ctx, { query: "kontrol", kind: "web" });
  assert.equal(result.sources[0].title, "Judul dengan [31mkontrol");
  assert.equal(result.sources[0].snippet, "Cuplikan dengan nul baris baru");
});

test("a vendor hiccup is retried, a wrong key is not, and the time budget is honest", async () => {
  // Two transient failures (429 with Retry-After, then a 500) before success.
  resetSearchCache();
  const { ctx } = fixture();
  const base = ctx.fetcher;
  let attempts = 0;
  ctx.fetcher = async (input: any, init: any) => {
    attempts++;
    if (attempts === 1)
      return new Response("slow down", {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    if (attempts === 2) return new Response("boom", { status: 500 });
    return base(input, init);
  };
  const recovered = await searchOne(ctx, {
    query: "cara pakai vite",
    kind: "web",
  });
  assert.equal(attempts, 3);
  assert.ok(recovered.sources.length >= 1);

  // A wrong key is final: one attempt, no retry storm, honest message.
  resetSearchCache();
  const bad = fixture();
  let badCalls = 0;
  bad.ctx.fetcher = async () => {
    badCalls++;
    return new Response("nope", { status: 401 });
  };
  await assert.rejects(
    () => searchOne(bad.ctx, { query: "kunci salah", kind: "web" }),
    /menolak permintaan \(401\)/,
  );
  assert.equal(badCalls, 1);

  // Retry-After may not hold the request hostage for half a minute.
  resetSearchCache();
  const capped = fixture({}, { retry: { baseMs: 0, maxWaitMs: 0 } });
  const cappedBase = fixture().ctx.fetcher;
  let cappedCalls = 0;
  capped.ctx.fetcher = async (input: any, init: any) => {
    cappedCalls++;
    if (cappedCalls === 1)
      return new Response("slow", {
        status: 429,
        headers: { "Retry-After": "30" },
      });
    return cappedBase(input, init);
  };
  const started = Date.now();
  const afterWait = await searchOne(capped.ctx, {
    query: "cara pakai vite",
    kind: "web",
  });
  assert.ok(
    Date.now() - started < 1500,
    "Retry-After 30 detik seharusnya dibatasi",
  );
  assert.equal(cappedCalls, 2);
  assert.ok(afterWait.sources.length >= 1);

  // When the budget runs out the report says how many tries really happened.
  resetSearchCache();
  const budget = fixture({}, { retry: { attempts: 5, budgetMs: 0 } });
  let budgetCalls = 0;
  budget.ctx.fetcher = async () => {
    budgetCalls++;
    return new Response("boom", { status: 503 });
  };
  await assert.rejects(
    () => searchOne(budget.ctx, { query: "batas waktu", kind: "web" }),
    /setelah 1 percobaan \(batas waktu percobaan tercapai\)/,
  );
  assert.equal(budgetCalls, 1);
});

test("results are cached with a time window, so one page is not billed twice", async () => {
  resetSearchCache();
  const { ctx, calls } = fixture();
  const first = await searchOne(ctx, {
    query: "NextJs 16 router",
    kind: "web",
  });
  const second = await searchOne(ctx, {
    query: "nextjs 16 router",
    kind: "web",
  });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(first.sources, second.sources);
  assert.equal(calls.length, 1);
});

test("the live verification script skips honestly and never calls a vendor without a key", () => {
  // Keys are cleared on purpose: this test must never spend real vendor quota.
  const env = {
    ...process.env,
    SEARCH_PROVIDER: "none",
    SEARCH_API_KEY: "",
  } as any;
  const run = (args: string[]) => {
    try {
      return {
        status: 0,
        stdout: execFileSync(
          process.execPath,
          ["scripts/verify-search-providers.mjs", ...args],
          { encoding: "utf8", env },
        ),
      };
    } catch (error: any) {
      return {
        status: Number(error.status),
        stdout: String(error.stdout || ""),
      };
    }
  };
  const none = run([]);
  assert.equal(none.status, 0);
  // The app's own configuration is printed first, then an honest skip.
  assert.match(none.stdout, /provider terpilih none/);
  assert.match(none.stdout, /DILEWATI none: SEARCH_PROVIDER belum diarahkan/);
  assert.match(none.stdout, /berarti tidak diuji, bukan berarti berfungsi/);
  // The next steps name the real variables, so a skip is actionable.
  assert.match(none.stdout, /SEARCH_PROVIDER=tavily/);
  assert.match(none.stdout, /SEARCH_API_KEY=\.\.\./);
  // Naming a provider without a key is a gap, so it must exit non-zero.
  const forced = run(["--provider=exa"]);
  assert.equal(forced.status, 1);
  assert.match(forced.stdout, /DILEWATI exa: SEARCH_API_KEY belum diisi\./);
  // A killed switch means no call at all, not a failed call.
  const off = run([]);
  assert.equal(off.status, 0);
  assert.equal(/^OK\s/m.test(off.stdout), false);
});

test("web search fails closed when nothing is configured, and never silently falls back", async () => {
  resetSearchCache();
  // The key exists but no provider is named, so no vendor may be guessed.
  const { ctx } = fixture({ SEARCH_PROVIDER: "none" });
  await assert.rejects(
    () => searchOne(ctx, { query: "apa pun", kind: "web" }),
    /Pencarian web belum dikonfigurasi/,
  );
  const capability = searchCapability(ctx.env);
  assert.equal(capability.web, false);
  assert.equal(capability.selected, "none");
  // Keyless code and docs search still work, so research is available; only the
  // explicit kill switch reports the feature as off.
  const adminEnv = {
    ...ctx.env,
    VITE_SUPABASE_URL: "u",
    VITE_SUPABASE_ANON_KEY: "a",
    SUPABASE_SERVICE_ROLE_KEY: "s",
  };
  assert.equal(capabilities(adminEnv).search, true);
  assert.equal(
    capabilities({ ...adminEnv, SEARCH_ENABLED: "false" }).search,
    false,
  );
  const off = searchCapability({ SEARCH_ENABLED: "off" });
  assert.equal(off.web, false);
  assert.equal(off.disabled, true);
  await assert.rejects(
    async () => resolveProvider({ SEARCH_ENABLED: "false" }, "web"),
    { message: /dinonaktifkan/ },
  );
  // A provider that no longer exists is refused by name, never run.
  await assert.rejects(
    async () => resolveProvider(ctx.env, "web", "context7"),
    {
      message: /tidak dikenal/,
    },
  );
  await assert.rejects(
    async () => resolveProvider(ctx.env, "lagu", undefined),
    {
      message: /tidak dikenal/,
    },
  );
  // The keyless kinds are gone, and asking for one says exactly that instead of
  // running a web search or returning an empty list.
  for (const kind of ["code", "docs"]) {
    await assert.rejects(
      async () => resolveProvider(ctx.env, kind, undefined),
      {
        message: /tidak lagi tersedia/,
      },
    );
  }
});

test("a page body that looks like a credential is redacted, not copied into the prompt", async () => {
  resetSearchCache();
  const { ctx } = fixture();
  const bodies = await fetchSourceBodies(
    {
      ...ctx,
      fetcher: async () =>
        new Response(
          "<html><title>Bocor</title><body>kunci AKIAIOSFODNN7EXAMPLE dan teks lain</body></html>",
          { headers: { "Content-Type": "text/html" } },
        ),
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    },
    [
      { index: 1, title: "Halaman", url: "https://bocor.example.test/a" },
    ] as any[],
    { limit: 1 },
  );
  const text = bodies[0].text as string;
  assert.doesNotMatch(text, /AKIAIOSFODNN7EXAMPLE/);
  assert.match(text, /kredensial diredaksi/);
  assert.match(text, /teks lain/);
});

test("provider markup is flattened before it reaches the prompt or the chat", async () => {
  resetSearchCache();
  const { ctx } = fixture(
    { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "k" },
    {
      payload: {
        results: [
          {
            title: "<b>Docs</b> &amp; contoh",
            url: "https://markup.example.test/x",
            content: "<mark>retry</mark> dengan <code>try/catch</code>",
          },
        ],
      },
    },
  );
  const hit = await searchOne(ctx, { query: "markup", kind: "web" });
  assert.equal(hit.sources[0].title, "Docs & contoh");
  assert.equal(hit.sources[0].snippet, "retry dengan try/catch");
});

test("the keyless code and docs paths are gone, and saying so costs nothing", async () => {
  resetSearchCache();
  const { ctx, calls } = fixture({
    SEARCH_PROVIDER: "none",
    SEARCH_API_KEY: "",
  });
  const capability = searchCapability(ctx.env);
  assert.equal(capability.web, false);
  assert.equal("code" in capability, false);
  assert.equal("docs" in capability, false);
  // No key means no provider at all: web fails closed and the retired kinds are
  // refused with a plain reason rather than answered from an anonymous source.
  await assert.rejects(
    async () => searchOne(ctx, { query: "cara pakai vite", kind: "web" }),
    { message: /belum dikonfigurasi/ },
  );
  for (const kind of ["code", "docs"]) {
    await assert.rejects(
      async () => searchOne(ctx, { query: "fetchWithRetry", kind }),
      { message: /tidak lagi tersedia/ },
    );
  }
  // Not one vendor was called, and no source was invented.
  assert.deepEqual(calls, []);
  // A whole round of retired kinds is reported per query, not thrown away.
  const round = await runSearch(ctx, {
    queries: ["retry helper"],
    kind: "code",
  });
  assert.equal(round.sources.length, 0);
  assert.match(round.rounds[0].error, /tidak lagi tersedia/);
});

test("sources keep the query that found them, and near-duplicates are dropped once", async () => {
  resetSearchCache();
  const { ctx } = fixture();
  const result = await runSearch(ctx, {
    queries: ["panduan vite", "konfigurasi vite"],
  });
  const urls = result.sources.map((s: any) => s.url);
  assert.deepEqual(urls, [
    "https://docs.example.test/a",
    "https://example.test/b",
  ]);
  // Each source names its own query instead of pretending it came from one search.
  assert.deepEqual(
    result.sources.map((s: any) => s.query),
    ["panduan vite", "panduan vite"],
  );
  // The second query returns the same two pages, so nothing is added twice.
  assert.deepEqual(
    result.rounds.map((r) => r.count),
    [2, 0],
  );
  assert.deepEqual(
    result.rounds.map((r) => r.duplicates),
    [0, 2],
  );

  // Tracking parameters and a trailing slash are the same page, not a new source.
  resetSearchCache();
  const tracking = fixture();
  tracking.ctx.fetcher = async () =>
    Response.json({
      results: [
        {
          title: "Satu",
          url: "https://dup.example.test/a?utm_source=x",
          content: "satu",
        },
        {
          title: "Satu",
          url: "https://www.dup.example.test/a/",
          content: "satu",
        },
      ],
    });
  const deduped = await runSearch(tracking.ctx, { queries: ["duplikat"] });
  assert.equal(deduped.sources.length, 1);
  assert.equal(deduped.rounds[0].duplicates, 1);

  // Same host and a near-identical title counts as the same page too.
  resetSearchCache();
  const nearTitle = fixture();
  nearTitle.ctx.fetcher = async () =>
    Response.json({
      results: [
        {
          title: "Cara pakai Vite dengan React",
          url: "https://dup.example.test/satu",
          content: "satu",
        },
        {
          title: "Cara pakai Vite dengan React 19",
          url: "https://dup.example.test/dua",
          content: "dua",
        },
        {
          title: "Halaman lain sama sekali",
          url: "https://dup.example.test/tiga",
          content: "tiga",
        },
      ],
    });
  const titles = await runSearch(nearTitle.ctx, { queries: ["vite"] });
  assert.deepEqual(
    titles.sources.map((s: any) => s.url),
    ["https://dup.example.test/satu", "https://dup.example.test/tiga"],
  );
});

test("the best-matching result is listed first, and locale bias is opt-in", async () => {
  resetSearchCache();
  const ranked = fixture();
  ranked.ctx.fetcher = async () =>
    Response.json({
      results: [
        {
          title: "Halaman umum",
          url: "https://rank.example.test/umum",
          content: "tidak menyebut apa pun yang dicari",
        },
        {
          title: "Dokumentasi useState untuk React",
          url: "https://rank.example.test/tepat",
          content: "useState pada React 19",
        },
      ],
    });
  const ordered = await runSearch(ranked.ctx, { queries: ["useState React"] });
  assert.equal(ordered.sources[0].url, "https://rank.example.test/tepat");

  // No locale by default: a silent bias would break English documentation queries.
  resetSearchCache();
  const plain = fixture();
  await searchOne(plain.ctx, { query: "vite", kind: "web" });
  const plainRequests = plain.requests;
  assert.equal(plainRequests.at(-1).body.country, undefined);
  assert.equal(plainRequests.at(-1).body.language, undefined);

  // With the env vars set, Tavily is told the country and language.
  resetSearchCache();
  const local = fixture({
    SEARCH_COUNTRY: "indonesia",
    SEARCH_LANGUAGE: "id",
  });
  await searchOne(local.ctx, { query: "resep rendang", kind: "web" });
  const localBody = local.requests.at(-1).body;
  assert.equal(localBody.country, "indonesia");
  assert.equal(localBody.language, "id");
  // The documented fields are still exactly the documented fields.
  assert.deepEqual(Object.keys(localBody).sort(), [
    "country",
    "include_answer",
    "language",
    "max_results",
    "query",
    "search_depth",
  ]);
});

test("runSearch batches queries, dedupes by URL, caps the count and reports per-query failures", async () => {
  resetSearchCache();
  const { ctx } = fixture();
  const result = await runSearch(ctx, {
    queries: ["satu", "dua", "tiga", "empat", "lima"],
  });
  assert.equal(result.rounds.length, SEARCH_QUERIES_MAX);
  assert.equal(
    new Set(result.sources.map((s: any) => s.url)).size,
    result.sources.length,
  );
  assert.deepEqual(
    result.sources.map((s: any) => s.index),
    result.sources.map((_: unknown, i: number) => i + 1),
  );

  const failing = await runSearch(
    { ...ctx, fetcher: async () => new Response("boom", { status: 500 }) },
    { queries: ["gagal"] },
  );
  assert.equal(failing.sources.length, 0);
  assert.equal(failing.rounds[0].count, 0);
  assert.match(failing.rounds[0].error, /menolak permintaan/);
});

test("search rejects empty queries, unknown providers and secret-shaped provider text", async () => {
  const { ctx } = fixture();
  await assert.rejects(
    () => runSearch(ctx, { queries: ["  "] }),
    /kata kunci/i,
  );
  await assert.rejects(
    () => searchOne(ctx, { query: "x", kind: "web", provider: "tidak-ada" }),
    /tidak dikenal/,
  );
  assert.throws(
    () =>
      assertCleanSources([
        {
          title: "bocor",
          snippet: "key=sk-live-abcdefghijklmnopqrstuvwxyz",
          url: "https://x.test",
          provider: "tavily",
          kind: "web",
        },
      ]),
    /pola kredensial/,
  );
  assert.equal(
    searchReservationId("2b1f0a54-0000-4000-8000-000000000000"),
    searchReservationId("2b1f0a54-0000-4000-8000-000000000000"),
  );
  assert.match(
    searchReservationId("2b1f0a54-0000-4000-8000-000000000000"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(
    searchReservationId("2b1f0a54-0000-4000-8000-000000000000"),
    searchReservationId("2b1f0a54-0000-4000-8000-000000000001"),
  );
  // Each round gets its own deterministic id, so a retried round is not billed
  // twice while a second round is still billed once.
  assert.notEqual(
    searchReservationId("2b1f0a54-0000-4000-8000-000000000000", 1),
    searchReservationId("2b1f0a54-0000-4000-8000-000000000000", 2),
  );
  assert.equal(
    searchReservationId("2b1f0a54-0000-4000-8000-000000000000", 2),
    searchReservationId("2b1f0a54-0000-4000-8000-000000000000", 2),
  );
  // The rounds cap is bounded and never unbounded.
  assert.equal(searchRoundsMax({}), 2);
  assert.equal(searchRoundsMax({ SEARCH_ROUNDS_MAX: "1" }), 1);
  assert.equal(searchRoundsMax({ SEARCH_ROUNDS_MAX: "5" }), 3);
  assert.equal(searchRoundsMax({ SEARCH_ROUNDS_MAX: "abc" }), 2);
});

test("search ops are validated strictly and separated from scene ops", () => {
  const { searches, rest } = splitSearchOps([
    { kind: "search", queries: ["roblox mesh limit"], type: "web" },
    { kind: "scene.transform", ops: [{ target: "a", move: [1, 0, 0] }] },
  ]);
  assert.equal(searches.length, 1);
  assert.equal(searches[0].type, "web");
  assert.equal(rest!.length, 1);
  // Nothing to split when the reply carries no ops at all.
  assert.deepEqual(splitSearchOps(undefined), {
    searches: [],
    rest: undefined,
  });
  for (const bad of [
    [{ kind: "search", queries: [] }],
    [{ kind: "search", queries: ["x"] }],
    [{ kind: "search", queries: ["ok"], type: "video" }],
    [{ kind: "search", queries: ["ok"], extra: true }],
    [{ kind: "search", queries: ["1", "2", "3", "4"] }],
  ])
    assert.throws(
      () => splitSearchOps(bad),
      /tidak valid/,
      JSON.stringify(bad),
    );
});

test("the research instruction is honest about what is available", () => {
  const none = researchInstruction({ web: false, code: false, docs: false });
  assert.match(none, /do not request a search/i);
  // A capability object that still carries the retired kinds promises nothing:
  // the instruction names exactly the kind that can really run.
  const web = researchInstruction({ web: true, code: true, docs: true });
  assert.match(web, /Available search kinds: web\./);
  assert.doesNotMatch(web, /docs/);
  assert.match(web, /You get 1 search round in total/);
  assert.match(web, /untrusted reference data/);
  // After the first of two rounds the model is told what it already has; once
  // the cap is reached it is told to stop asking.
  const second = researchInstruction(
    { web: true, code: false, docs: false },
    { round: 1, max: 2 },
  );
  assert.match(second, /Round 1 of 2 has finished/);
  assert.doesNotMatch(second, /No further search is possible/);
  const done = researchInstruction(
    { web: true, code: false, docs: false },
    { round: 2, max: 2 },
  );
  assert.match(done, /No further search is possible/);
  assert.match(done, /say plainly if they are not enough/);
  assert.equal(researchStatus({ SEARCH_PROVIDER: "none" }).web, false);
  assert.equal(
    researchStatus({ SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "x" }).provider,
    "tavily",
  );
  assert.equal(
    researchStatus({ SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "x" })
      .available,
    true,
  );
  // Nothing keyless is left, so without a key research reports itself as
  // unavailable rather than quietly working from an anonymous source.
  assert.equal(researchStatus({ SEARCH_PROVIDER: "none" }).available, false);
});

test("the sources block numbers every source and marks unreadable pages", () => {
  const prompt = sourcesPrompt({
    sources: [
      {
        index: 1,
        title: "A",
        url: "https://a.test",
        provider: "tavily",
        kind: "web",
        snippet: "cuplikan A",
      },
      {
        index: 2,
        title: "B",
        url: "https://b.test",
        provider: "tavily",
        kind: "web",
        snippet: "cuplikan B",
      },
    ],
    bodies: [
      { index: 1, url: "https://a.test", title: "A", text: "isi halaman" },
      {
        index: 2,
        url: "https://b.test",
        title: "B",
        text: "",
        unreadable: true,
      },
    ],
  });
  assert.match(prompt, /\[1\] A — https:\/\/a\.test/);
  assert.match(prompt, /isi halaman/);
  assert.match(prompt, /halaman tidak dapat dibaca/);
});

test("a round only returns new sources, and the report counts what was really read", async () => {
  resetSearchCache();
  const { ctx } = fixture();
  // `seen` now holds canonical keys, so tracking links cannot smuggle a
  // duplicate back into a later round.
  const seen = new Set([canonicalSourceKey("https://docs.example.test/a")]);
  const round = await runSearchRound(ctx, {
    searches: [{ queries: ["dokumen"], type: "web" }],
    seen,
  });
  // `seen` started with the first fixture hit, so only the second one is new,
  // and it arrives unnumbered: the caller owns the numbering.
  assert.equal(round.sources.length, 1);
  assert.equal(round.sources[0].url, "https://example.test/b");
  assert.equal(round.sources[0].index, undefined);
  assert.equal(seen.size, 2);
  assert.ok(seen.has("example.test/b"));
  assert.equal(round.rounds.length, 1);

  const numbered = [{ ...round.sources[0], index: 4 }];
  const bodies = await readBodies(ctx, {
    sources: numbered as any,
    read: READ_SOURCES_MAX,
  });
  // The read budget is exhausted, so nothing is fetched again.
  assert.deepEqual(bodies, []);

  const report = buildResearchReport({
    rounds: [{ ...round.rounds[0], count: 1 }] as any,
    sources: numbered as any,
    bodies: [{ index: 4, text: "isi", url: numbered[0].url }] as any,
    notes: ["Catatan operator ikut dilaporkan."],
  });
  assert.equal(report.sources.length, 1);
  assert.deepEqual(Object.keys(report.sources[0]).sort(), [
    "index",
    "kind",
    "provider",
    "query",
    "title",
    "url",
  ]);
  assert.equal(report.read, 1);
  assert.match(report.notice, /1 sumber dari 1 pencarian; 1 halaman dibaca/);
  assert.match(report.notice, /data tidak tepercaya/);
  assert.match(report.notice, /Catatan operator ikut dilaporkan\./);
  assert.equal(SOURCES_TOTAL_MAX, 12);
});

test("citations are mapped to real sources; invented numbers are flagged, not resolved", () => {
  const sources = [{ index: 1 }, { index: 2 }] as any[];
  const good = citationReport(
    "Menurut dokumentasi [1], batasnya 250 objek [2].",
    sources,
  );
  assert.deepEqual(good.cited, [1, 2]);
  assert.deepEqual(good.uncited, []);
  assert.deepEqual(good.invalid, []);
  assert.equal(good.citationNotice, "");

  const bad = citationReport(
    "Menurut sumber [9] dan [0] jawabannya jelas.",
    sources,
  );
  assert.deepEqual(bad.cited, []);
  assert.deepEqual(bad.uncited, [1, 2]);
  assert.deepEqual(bad.invalid, [9, 0]);
  assert.match(bad.citationNotice, /tidak mengutip/);

  const partial = citationReport("Hanya [2] yang relevan.", sources);
  assert.deepEqual(partial.cited, [2]);
  assert.deepEqual(partial.uncited, [1]);
});

test("every provider left needs a key, so nothing is called anonymously", () => {
  const names = Object.keys(providers);
  assert.ok(names.length >= 1, "setidaknya satu provider web harus ada");
  for (const [name, provider] of Object.entries(providers)) {
    assert.ok(provider.label, name);
    assert.equal(provider.kind, "web", name);
    // The key is the whole gate: no key, no call.
    assert.equal(provider.env, "SEARCH_API_KEY", name);
  }
  // The keyless vendors are gone from the registry entirely.
  for (const retired of ["grepp", "context7"]) {
    assert.equal(retired in providers, false, retired);
  }
});

test("the grounding check is a heuristic, and it says so", () => {
  const sources = [
    { index: 1, title: "Panduan Vite", url: "https://a.test", snippet: "" },
    {
      index: 2,
      title: "Artikel pertanian",
      url: "https://b.test",
      snippet: "",
    },
    { index: 3, title: "Tanpa isi", url: "https://c.test", snippet: "" },
  ];
  const bodies = [
    {
      index: 1,
      url: "https://a.test",
      title: "Panduan Vite",
      text: "Gunakan pengulangan berjenjang untuk menangani galat jaringan.",
    },
    {
      index: 2,
      url: "https://b.test",
      title: "Artikel pertanian",
      text: "Panen kopi di dataran tinggi menurun karena curah hujan.",
    },
    { index: 3, url: "https://c.test", title: "Tanpa isi", text: "" },
  ];
  const report = groundingReport(
    "Gunakan pengulangan berjenjang untuk galat jaringan [1]. Harga emas naik tajam [2]. Ya [3].",
    sources as any,
    bodies as any,
  );
  // [1] shares words with its page, [2] does not, [3] is too short to judge and
  // its page has no text at all.
  assert.equal(report.checked, 1);
  assert.deepEqual(report.unsupported, [2]);
  assert.deepEqual(report.insufficient, [3]);
  assert.match(report.groundingNotice, /sitasi 2/);
  assert.match(report.groundingNotice, /heuristik/);
  // The notice must never claim the claim was verified.
  assert.doesNotMatch(report.groundingNotice, /terverifikasi|diverifikasi/);

  // Nothing cited: no notice, and nothing claimed as checked.
  const quiet = groundingReport(
    "Jawaban tanpa sumber.",
    sources as any,
    bodies as any,
  );
  assert.deepEqual(quiet.unsupported, []);
  assert.equal(quiet.checked, 0);
  assert.equal(quiet.groundingNotice, "");
});

test("the cross-page synthesis is validated like any other model output", () => {
  const sources = [
    { index: 1, title: "Satu", url: "https://a.test/x", snippet: "" },
    { index: 2, title: "Dua", url: "https://b.test/y", snippet: "" },
  ];
  // A fenced JSON answer is read as JSON, and the prose comes back as `text`.
  const json = parseSummary(
    '```json\n{"summary":"Kedua halaman sepakat [1].","covers":[1,2],"gaps":"tidak ada"}\n```',
    { sources },
  );
  assert.equal(json.text, "Kedua halaman sepakat [1].");
  assert.deepEqual(json.covers, [1, 2]);
  assert.deepEqual(json.cited, [1]);
  assert.equal(json.gaps, "tidak ada");
  assert.equal(json.notice, "");

  // Plain prose is a summary too: a model that skips the JSON envelope must not
  // cost the synthesis.
  const prose = parseSummary("Ringkasan biasa tanpa JSON.", { sources });
  assert.equal(prose.text, "Ringkasan biasa tanpa JSON.");
  assert.deepEqual(prose.covers, []);
  assert.deepEqual(prose.cited, []);

  // A ghost number is reported as a number, never resolved into a source.
  const ghost = parseSummary(
    '{"summary":"Menurut [7] hal ini rumit.","covers":[1,7],"gaps":""}',
    { sources },
  );
  assert.deepEqual(ghost.invalid, [7]);
  assert.deepEqual(ghost.covers, [1]);
  assert.match(ghost.notice, /nomor sumber yang tidak pernah dikembalikan: 7/);
  // A link that is not one of the sources is removed from the text, not kept.
  const foreign = parseSummary(
    '{"summary":"Lihat https://jahat.test/z untuk detail [1].","covers":[1],"gaps":""}',
    { sources },
  );
  assert.doesNotMatch(foreign.text, /jahat\.test/);
  assert.deepEqual(foreign.foreignUrls, ["https://jahat.test/z"]);
  assert.match(foreign.notice, /Tautan yang bukan salah satu sumber dihapus/);
  // A real source URL survives untouched.
  const kept = parseSummary(
    '{"summary":"Baca https://a.test/x dulu.","covers":[1],"gaps":""}',
    { sources },
  );
  assert.match(kept.text, /https:\/\/a\.test\/x/);

  // Nothing at all: reported as such instead of shown as an empty block.
  const empty = parseSummary("   ", { sources });
  assert.equal(empty.text, "");
  assert.match(empty.notice, /tidak berisi apa pun/);

  // The cap is enforced, and the truncation is said out loud.
  const long = parseSummary("x".repeat(SUMMARY_CHARS_MAX + 50), { sources });
  assert.equal(long.text.length, SUMMARY_CHARS_MAX + 1);
  assert.match(long.notice, new RegExp(`dipotong pada ${SUMMARY_CHARS_MAX}`));
});

test("the summarization instructions keep the synthesis inside the sources", () => {
  const instruction = summaryInstruction({
    pages: 3,
    question: "Apa itu retry?",
  });
  // Bounded, cited, and explicit that the pages are the only source of facts.
  assert.match(instruction, /use only facts that are in the numbered sources/);
  assert.match(instruction, /never invent a source, URL, number or quote/);
  assert.match(instruction, /Apa itu retry\?/);
  assert.match(instruction, new RegExp(String(SUMMARY_CHARS_MAX)));

  // The block handed to the answer pass labels the synthesis as a model's words.
  const block = summaryPromptBlock({
    text: "Kedua halaman sepakat [1].",
    covers: [1, 2],
  });
  assert.match(
    block,
    /RINGKASAN LINTAS HALAMAN \(dibuat AI dari halaman \[1\], \[2\]/,
  );
  assert.match(block, /BUKAN kutipan/);
  assert.match(block, /bukan kata dari halaman mana pun/);
  // No synthesis: no block, so a prompt never promises something that is absent.
  assert.equal(summaryPromptBlock(null), "");
  assert.equal(summaryPromptBlock({ text: "" }), "");

  // The switch and the announced availability agree with each other.
  assert.equal(summaryEnabled({}), true);
  assert.equal(summaryEnabled({ RESEARCH_SUMMARY: "true" }), true);
  for (const off of ["false", "FALSE", "0", "off", "no"])
    assert.equal(summaryEnabled({ RESEARCH_SUMMARY: off }), false);
  assert.equal(SUMMARY_PAGES_MIN >= 2, true);
});

test("a citation only the AI synthesis supports is reported as such, not as page-backed", () => {
  const sources = [
    { index: 1, title: "Panduan", url: "https://a.test", snippet: "" },
  ];
  const bodies = [
    {
      index: 1,
      url: "https://a.test",
      title: "Panduan",
      text: "Gunakan pengulangan berjenjang untuk menangani galat jaringan.",
    },
  ];
  const summary = {
    text: "Sumber menyarankan backoff eksponensial berlapis.",
    covers: [1],
  };
  const viaSummary = groundingReport(
    "Pakai backoff eksponensial berlapis [1].",
    sources as any,
    bodies as any,
    summary,
  );
  assert.deepEqual(viaSummary.viaSummary, [1]);
  assert.deepEqual(viaSummary.unsupported, []);
  assert.match(viaSummary.groundingNotice, /hanya didukung ringkasan AI/);

  // A synthesis that does not cover that page cannot launder the citation: the
  // claim stays unsupported rather than becoming summary-backed.
  const uncovered = groundingReport(
    "Pakai backoff eksponensial berlapis [1].",
    sources as any,
    bodies as any,
    { text: summary.text, covers: [] },
  );
  assert.deepEqual(uncovered.viaSummary, []);
  assert.deepEqual(uncovered.unsupported, [1]);
  assert.equal(uncovered.groundingNotice.includes("hanya didukung"), false);

  // Words the page really has still count as page-backed, summary or not.
  const page = groundingReport(
    "Gunakan pengulangan berjenjang untuk galat jaringan [1].",
    sources as any,
    bodies as any,
    summary,
  );
  assert.deepEqual(page.viaSummary, []);
  assert.deepEqual(page.unsupported, []);
  assert.equal(page.checked, 1);
});

test("the sources block puts the synthesis in its own labelled section", () => {
  const prompt = sourcesPrompt({
    sources: [{ index: 1, title: "Satu", url: "https://a.test/x" }] as any,
    bodies: [] as any,
    summary: { text: "Ringkasan model [1].", covers: [1] },
  });
  assert.match(prompt, /\[1\] Satu/);
  assert.match(prompt, /RINGKASAN LINTAS HALAMAN/);
  assert.match(prompt, /BUKAN kutipan, tetap data tidak tepercaya/);
  // Without a synthesis the block is exactly the deterministic excerpts.
  const plain = sourcesPrompt({
    sources: [{ index: 1, title: "Satu", url: "https://a.test/x" }] as any,
    bodies: [] as any,
  });
  assert.doesNotMatch(plain, /RINGKASAN LINTAS HALAMAN/);
});

test("a PDF, a markdown page and a thin page are all read honestly", async () => {
  resetSearchCache();
  const sources = [
    {
      index: 1,
      title: "Dokumen PDF",
      url: "https://dok.example.test/panduan.pdf",
    },
    { index: 2, title: "Markdown", url: "https://dok.example.test/readme.md" },
    { index: 3, title: "Halaman JS-only", url: "https://dok.example.test/spa" },
    { index: 4, title: "Rusak", url: "https://dok.example.test/rusak" },
  ];
  const longHtml =
    "<html><title>Panjang</title><body>" +
    "Isi halaman yang cukup panjang untuk membuktikan batas karakter baru. ".repeat(
      120,
    ) +
    "</body></html>";
  const { ctx } = fixture();
  ctx.fetcher = async (input: any) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.pathname.endsWith(".pdf"))
      return new Response(pdfBytes("Konten dokumen uji untuk riset."), {
        headers: { "Content-Type": "application/pdf" },
      });
    if (url.pathname.endsWith(".md"))
      return new Response("# Panduan\n\nLangkah pemasangan ada di sini.", {
        headers: { "Content-Type": "text/markdown" },
      });
    if (url.pathname === "/spa")
      return new Response(
        '<html><body><div id="app"></div><script></script></body></html>',
        {
          headers: { "Content-Type": "text/html" },
        },
      );
    if (url.pathname === "/rusak")
      return new Response("gagal", { status: 500 });
    return new Response(longHtml, { headers: { "Content-Type": "text/html" } });
  };
  const bodies = await fetchSourceBodies(
    { ...ctx, resolver: async () => [{ address: "93.184.216.34", family: 4 }] },
    sources as any[],
    { limit: 4 },
  );
  // 1. A PDF is parsed for real, and the model is told it is a PDF.
  assert.equal(bodies[0].kind, "pdf");
  assert.match(bodies[0].text as string, /Konten dokumen uji untuk riset/);
  // 2. Markdown arrives as text, with its heading.
  assert.equal(bodies[1].kind, "text");
  assert.match(bodies[1].text as string, /Langkah pemasangan/);
  // 3. A JavaScript shell is not silently treated as a well-read page.
  assert.equal(bodies[2].unreadable, undefined);
  assert.match(String(bodies[2].note), /JavaScript/);
  // 4. A failed fetch carries the real reason, not a generic shrug.
  assert.equal(bodies[3].unreadable, true);
  assert.match(String(bodies[3].reason), /tidak dapat diakses/);
  // 5. The read budget grew: a long page is no longer cut at 4.000 characters.
  const long = await fetchSourceBodies(
    { ...ctx, resolver: async () => [{ address: "93.184.216.34", family: 4 }] },
    [
      { index: 1, title: "Panjang", url: "https://dok.example.test/long" },
    ] as any[],
    { limit: 1 },
  );
  assert.ok((long[0].text as string).length > 4000);
  assert.ok((long[0].text as string).length <= 6000);

  // The design-reference path keeps its old contract: no documents.
  await assert.rejects(
    () =>
      fetchReference("https://dok.example.test/panduan.pdf", {
        fetcher: async () =>
          new Response(pdfBytes("x"), {
            headers: { "Content-Type": "application/pdf" },
          }),
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      } as any),
    /HTML atau teks/,
  );
});

test("a long page reaches the model as relevance-sized excerpts, never as invented prose", () => {
  const page = [
    "Pengantar tanpa kata kunci apa pun.",
    "Retry berjenjang memakai backoff eksponensial dengan jitter supaya klien tidak menyerbu bersamaan.",
    "Bagian lain yang tidak berhubungan sama sekali dengan pertanyaan pengguna.",
    "Kegagalan 429 harus dihormati lewat header Retry-After sebelum mencoba lagi.",
    "Penutup dokumen.",
  ].join(" ");
  const excerpt = selectExcerpt(page, ["retry", "backoff", "429"], 240);
  // The sentences that share words with the queries survive, in page order,
  // and the skips are marked so nobody reads a jump as the whole page.
  assert.match(excerpt, /Retry berjenjang memakai backoff/);
  assert.match(excerpt, /429 harus dihormati/);
  assert.ok(
    excerpt.indexOf("Retry berjenjang") <
      excerpt.indexOf("429 harus dihormati"),
  );
  assert.match(excerpt, /\[…\]/);
  assert.doesNotMatch(excerpt, /Pengantar tanpa kata kunci/);
  assert.ok(excerpt.length <= 280);
  // Every word comes from the page itself: an excerpt is evidence, not a summary.
  const sourceWords = new Set(page.toLowerCase().match(/[\p{L}\p{N}]+/gu));
  for (const word of excerpt.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    assert.ok(sourceWords.has(word), `kata "${word}" tidak ada di halaman`);

  // Without query terms the opening is sent, still marked as cut.
  const head = selectExcerpt(page, [], 60);
  assert.ok(head.startsWith("Pengantar"));
  assert.match(head, /\[…\]/);
  // A page that already fits is passed through untouched.
  assert.equal(selectExcerpt("pendek saja", ["retry"], 100), "pendek saja");
  // Nothing matches the queries: the page is still evidence, so its opening is
  // sent instead of an empty block.
  const off = selectExcerpt(page, ["zzz-tidak-ada"], 70);
  assert.ok(off.startsWith("Pengantar"));
});

test("a turn reads up to eight pages, and each one carries both the excerpt and the fuller text", async () => {
  resetSearchCache();
  const { ctx } = fixture();
  const fetched: string[] = [];
  const longHtml = `<html><title>Halaman panjang</title><body>${Array.from(
    { length: 700 },
    (_, i) => `Kalimat ${i} menjelaskan retry dan backoff untuk klien.`,
  ).join(" ")}</body></html>`;
  const bodies = await readBodies(
    {
      ...ctx,
      fetcher: async (input: any) => {
        fetched.push(String(input));
        return new Response(longHtml, {
          headers: { "Content-Type": "text/html" },
        });
      },
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    },
    {
      sources: Array.from({ length: 10 }, (_, i) => ({
        index: i + 1,
        title: "Halaman " + (i + 1),
        url: `https://dokumen.example.test/h${i + 1}`,
        snippet: "cuplikan",
        query: "retry backoff",
      })) as any[],
      terms: ["retry", "backoff"],
    },
  );
  // Eight pages, not five: the read budget grew, and the ninth is not fetched.
  assert.equal(bodies.length, READ_SOURCES_MAX);
  assert.equal(READ_SOURCES_MAX, 8);
  assert.equal(fetched.length, 8);
  const first = bodies[0] as any;
  assert.ok(first.text.length > READ_EXCERPT_CHARS);
  assert.ok(first.excerpt.length <= READ_EXCERPT_CHARS + 40);
  assert.equal(first.truncated, true);
  // The prompt shows the excerpt and says what it is, so a short block is never
  // mistaken for a short page.
  const prompt = sourcesPrompt({
    sources: [
      {
        index: 1,
        title: "Halaman 1",
        url: "https://dokumen.example.test/h1",
        provider: "tavily",
        kind: "web",
        snippet: "cuplikan",
      },
    ] as any[],
    bodies,
  });
  assert.match(prompt, /kutipan relevan dari halaman/);
  assert.ok(prompt.includes(first.excerpt.slice(0, 40)));
  assert.ok(!prompt.includes(first.text.slice(READ_EXCERPT_CHARS)));
});

test("the search cache is shared across instances, and falls back when it cannot be", async () => {
  resetSearchCache();
  // Two caches, one table: the second instance pays nothing for the same query.
  const rows = new Map<string, any>();
  const first = createSearchCache({ admin: cacheAdmin(rows), env: {} });
  const payload = {
    provider: "tavily",
    label: "Tavily",
    kind: "web",
    query: "cara pakai vite",
    sources: [{ title: "A", url: "https://a.test", snippet: "isi" }],
  };
  await first.set(cacheKey(["tavily", "web", "cara pakai vite"]), payload);
  assert.equal(first.mode(), "shared");

  const second = createSearchCache({ admin: cacheAdmin(rows), env: {} });
  const hit = await second.get(cacheKey(["tavily", "web", "cara pakai vite"]));
  assert.ok(hit);
  assert.equal(hit!.mode, "shared");
  assert.equal(hit!.value.query, "cara pakai vite");
  assert.equal(second.stats.sharedHits, 1);

  // Switching the shared layer off is possible without touching the memory one.
  const local = createSearchCache({
    admin: cacheAdmin(rows),
    env: { SEARCH_CACHE_SHARED: "false" },
  });
  assert.equal(local.mode(), "process");
  await local.set("k", payload);
  assert.equal((await local.get("k"))!.mode, "process");

  // A missing table is a configuration fact: one failed round trip, then memory.
  const missing = createSearchCache({
    admin: cacheAdmin(new Map(), { missing: true }),
    env: {},
  });
  assert.equal(await missing.get("k"), null);
  assert.equal(missing.mode(), "process");
  assert.equal(missing.stats.errors, 1);
  await missing.set("k", payload);
  assert.equal((await missing.get("k"))!.value.query, "cara pakai vite");
  assert.equal(missing.stats.errors, 1);
});

test("a shared hit answers a real search without calling the vendor", async () => {
  resetSearchCache();
  const rows = new Map<string, any>();
  rows.set(cacheKey(["tavily", "web", "cara pakai vite"]), {
    payload: {
      provider: "tavily",
      label: "Tavily",
      kind: "web",
      query: "cara pakai vite",
      sources: [
        { title: "Dari cache", url: "https://cache.test/a", snippet: "isi" },
      ],
    },
    expires_at: new Date(Date.now() + 60000).toISOString(),
  });
  let vendorCalls = 0;
  const { ctx } = fixture();
  ctx.admin = cacheAdmin(rows);
  ctx.fetcher = async () => {
    vendorCalls++;
    throw new Error("vendor harusnya tidak dipanggil");
  };
  const result = await searchOne(ctx, {
    query: "cara pakai vite",
    kind: "web",
  });
  assert.equal(vendorCalls, 0);
  assert.equal(result.cached, true);
  assert.equal(result.cacheMode, "shared");
  assert.equal(result.sources[0].title, "Dari cache");
  resetSearchCache();
});

test("native tools are offered only for the kinds that exist, plus opening a page", () => {
  const web = researchTools({ web: true, code: false, docs: false });
  assert.deepEqual(
    web.map((tool: any) => tool.function.name),
    ["search", "read_page"],
  );
  const search = web[0].function as any;
  // A pointer at the vendor-shaped tool field: the JSON schema handed to a
  // provider has to be valid on its own.
  assert.deepEqual(search.parameters.properties.type.enum, ["web"]);
  assert.deepEqual(search.parameters.required, ["queries"]);
  assert.equal(search.parameters.additionalProperties, false);
  assert.equal(
    search.parameters.properties.queries.maxItems,
    SEARCH_QUERIES_MAX,
  );
  // Web is the only kind there is, so the schema never promises another one —
  // even when a caller hands over a capability object with retired kinds in it.
  const all = researchTools({ web: true, code: true, docs: true });
  assert.deepEqual(all[0].function.parameters.properties.type.enum, ["web"]);
  // No provider at all: the tool list never promises a search the server
  // cannot run, it only offers to open a page the model already knows.
  assert.deepEqual(
    researchTools({ web: false, code: false, docs: false }).map(
      (tool: any) => tool.function.name,
    ),
    ["read_page"],
  );
});

test("tool calls become the same operations as the JSON protocol, and odd ones are named", () => {
  const ops = toolCallsToOps([
    {
      id: "call_1",
      function: {
        name: "search",
        arguments: '{"queries":["retry next.js","vite 6"]}',
      },
    },
    {
      id: "call_2",
      function: { name: "search_code", arguments: '{"query":"retry helper"}' },
    },
    {
      id: "call_3",
      function: {
        name: "read_page",
        arguments: '{"url":"https://contoh.example.test/a"}',
      },
    },
    { id: "call_4", function: { name: "read_page", arguments: '{"index":2}' } },
    { id: "call_5", function: { name: "delete_repo", arguments: "{}" } },
    { id: "call_6", function: { name: "search", arguments: "bukan json" } },
    { id: "call_7", function: { name: "search", arguments: '{"queries":[]}' } },
  ]);
  assert.equal(ops.searches.length, 1);
  assert.deepEqual(ops.searches[0], {
    kind: "search",
    queries: ["retry next.js", "vite 6"],
    type: "web",
    id: "call_1",
  });
  // `search_code` went away with the keyless code path, so it is reported as a
  // tool we do not have instead of being answered as a web search.
  assert.ok(ops.unknown.includes("search_code"));
  assert.deepEqual(
    ops.fetches.map((fetch: any) => fetch.url || fetch.index),
    ["https://contoh.example.test/a", 2],
  );
  // A tool we do not have is reported, never quietly treated as a search.
  assert.deepEqual(ops.unknown, ["search_code", "delete_repo"]);
  assert.deepEqual(ops.invalid, ["search", "search"]);
  // Nothing usable at all: no operation, and the caller can see why.
  assert.deepEqual(toolCallsToOps([{ function: { name: "buka" } }]).unknown, [
    "buka",
  ]);
  const many = toolCallsToOps([
    {
      id: "call_8",
      function: {
        name: "search",
        arguments: JSON.stringify({
          queries: ["a1", "b2", "c3", "d4", "e5"],
        }),
      },
    },
  ]);
  assert.equal(many.searches[0].queries.length, SEARCH_QUERIES_MAX);
});

test("the model may open a page it found, and it becomes a numbered source", async () => {
  const fetched: string[] = [];
  const ctx = {
    ...fixture().ctx,
    fetcher: async (input: any) => {
      fetched.push(String(input));
      return new Response(
        "<html><title>Panduan retry</title><body>Gunakan backoff eksponensial sebelum mencoba ulang. Kalimat lain tidak penting.</body></html>",
        { headers: { "Content-Type": "text/html" } },
      );
    },
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
  };
  const opened = await openSources(ctx, {
    fetches: [
      { kind: "fetch", url: "https://baru.example.test/panduan", id: "call_1" },
    ],
    sources: [
      {
        index: 1,
        title: "Lama",
        url: "https://lama.example.test/a",
        snippet: "cuplikan",
        kind: "web",
        provider: "tavily",
        query: "q",
      },
    ] as any,
    bodies: [
      {
        index: 1,
        url: "https://lama.example.test/a",
        title: "Lama",
        text: "Isi lama",
      },
    ] as any,
    read: 1,
    terms: significantTerms("backoff mencoba ulang"),
  });
  assert.equal(fetched.length, 1);
  // Numbering continues after the sources already numbered in this turn.
  assert.equal(opened.sources.length, 1);
  assert.equal(opened.sources[0].index, 2);
  assert.equal(opened.sources[0].provider, OPENED_PROVIDER);
  assert.match(opened.sources[0].title, /Panduan retry/);
  assert.equal(opened.bodies.length, 1);
  assert.match(opened.bodies[0].text, /backoff eksponensial/);
  assert.equal(opened.results[0].id, "call_1");
  assert.equal(opened.results[0].added, true);
  assert.match(openResultText(opened.results[0]), /sumber baru \[2\]/);
  assert.match(openResultText(opened.results[0]), /backoff eksponensial/);
  // What the model is told about a search says what is new and what failed.
  const told = toolResultText({
    added: opened.sources,
    bodies: opened.bodies,
    rounds: [
      { query: "gagal", error: "Sumber pencarian gagal dihubungi." },
      { query: "oke", count: 1, error: "" },
    ] as any,
  });
  assert.match(told, /\[2\] Panduan retry/);
  assert.match(told, /"gagal" gagal: Sumber pencarian gagal dihubungi\./);
  assert.match(toolResultText({}), /tidak menambah sumber baru/);
});

test("opening a page never fakes a source: known, refused, unreadable and over-budget", async () => {
  const known = {
    index: 3,
    url: "https://lama.example.test/a",
    title: "Lama",
    text: "Isi yang sudah dibaca",
  };
  const sources = [
    {
      index: 3,
      title: "Lama",
      url: "https://lama.example.test/a",
      snippet: "cuplikan",
      kind: "web",
      provider: "tavily",
      query: "q",
    },
  ] as any;
  let visits = 0;
  const ctx = {
    ...fixture().ctx,
    fetcher: async (input: any) => {
      visits += 1;
      if (String(input).includes("mati.example.test"))
        return new Response("no", { status: 500 });
      return new Response(
        "<html><title>Baru</title><body>Isi baru.</body></html>",
        {
          headers: { "Content-Type": "text/html" },
        },
      );
    },
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
  };
  const already = await openSources(ctx, {
    fetches: [{ kind: "fetch", index: 3, id: "call_1" }],
    sources,
    bodies: [known] as any,
    read: 1,
  });
  // A source that already has a body is not fetched again.
  assert.equal(visits, 0);
  assert.equal(already.sources.length, 0);
  assert.equal(already.results[0].added, false);
  assert.match(openResultText(already.results[0]), /Isi yang sudah dibaca/);

  const refused = await openSources(ctx, {
    fetches: [
      { kind: "fetch", url: "http://tidak-aman.example.test/x" },
      { kind: "fetch", url: "bukan url" },
      { kind: "fetch", url: "https://mati.example.test/x" },
      // A fourth request fits the vendor cap, so it is dropped, not run.
      { kind: "fetch", url: "https://baru.example.test/lain" },
    ],
    sources,
    bodies: [known] as any,
    read: 1,
  });
  // Nothing insecure, unknown or unreadable ever becomes a source.
  assert.equal(refused.sources.length, 0);
  assert.equal(refused.results.length, FETCH_MAX_DEFAULT);
  assert.match(refused.results[0].note, /HTTPS/);
  assert.match(refused.results[1].note, /tidak valid/);
  assert.match(refused.results[2].note, /tidak dapat diakses/);
  for (const result of refused.results)
    assert.match(openResultText(result), /tidak dapat dibuka/);

  const unknownIndex = await openSources(ctx, {
    fetches: [{ kind: "fetch", index: 99 }],
    sources,
    bodies: [known] as any,
    read: 1,
  });
  assert.match(unknownIndex.results[0].note, /tidak ada di daftar sumber/);

  const over = await openSources(
    {
      ...ctx,
      fetcher: async () => {
        throw new Error("anggaran habis: tidak boleh ada panggilan jaringan");
      },
    },
    {
      fetches: [
        { kind: "fetch", url: "https://baru.example.test/a" },
        { kind: "fetch", url: "https://baru.example.test/b" },
      ],
      sources,
      bodies: [known] as any,
      read: READ_SOURCES_MAX,
    },
  );
  assert.equal(over.sources.length, 0);
  assert.match(over.results[0].note, new RegExp(`Batas ${READ_SOURCES_MAX}`));
  // The per-round cap is enforced here, not only promised in the prompt.
  assert.equal(FETCH_MAX_DEFAULT, 3);
});

test("researchInstruction teaches one protocol at a time", () => {
  const withTools = researchInstruction(
    { web: true, code: false, docs: false },
    { max: 2, tools: true },
  );
  assert.match(withTools, /CALL the provided tools/);
  assert.match(withTools, /`read_page`/);
  assert.doesNotMatch(withTools, /"kind":"search"/);
  const withoutTools = researchInstruction({ web: true }, { max: 2 });
  assert.match(withoutTools, /"kind":"search"/);
  assert.doesNotMatch(withoutTools, /CALL the provided tools/);
  // Both protocols keep the same hard rules.
  for (const prompt of [withTools, withoutTools]) {
    assert.match(prompt, /Never invent a source/);
    assert.match(prompt, /untrusted reference data/);
  }
});
