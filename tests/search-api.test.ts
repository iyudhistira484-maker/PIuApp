import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createApp } from "../server/app.mjs";
import { resetSearchCache } from "../server/lib/search.mjs";
import { SCENE_PATH } from "../server/lib/ai-ops.mjs";
import { defaultSite } from "../server/lib/platform.mjs";

// End-to-end proof that the research loop is honest end to end: the model asks
// for sources, the server really searches and reads pages, the tools' credit is
// billed once and refunded when nothing came back, and the browser receives the
// numbered sources plus a report that never resolves a citation that was not
// returned. The fake provider speaks the real OpenAI-compatible SSE contract.

const ids = { member: "7f1c3d2e-1111-4222-8333-444455556666" };
const PUBLIC_IP = "93.184.216.34";

const savedScene = () =>
  JSON.stringify({
    version: 1,
    objects: [
      {
        id: "obj-rumah",
        name: "Rumah",
        kind: "model",
        parent: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1, 1, 1],
        color: "#ffffff",
        anchored: true,
      },
    ],
  });

type Fixture = {
  provider?: Record<string, unknown>;
  results?: unknown[];
  /** Lets a second search round return different pages than the first. */
  resultsByQuery?: Record<string, unknown[]>;
  /** One provider reply per pass, so a multi-round turn can be scripted. */
  replies?: any[];
  reply?: any;
  researchReply?: any;
  pages?: Record<string, string>;
  searchStatus?: number;
  /** Shared fake of the `runtime_search_cache` table (migration 009). */
  cacheRows?: Map<string, any>;
  /** Holds a vendor call open until the test releases it. */
  gates?: { chat?: Promise<void>; search?: Promise<void> };
  /** Status a provider returns when the request carries native tools. */
  toolsStatus?: number;
  /** Reply for the abstractive summary pass; a string speaks plain prose. */
  summaryReply?: any;
  /** Kind of the saved project the route loads (default: webapp). */
  projectKind?: string;
};

function fixture({
  results = [
    {
      title: "Dokumentasi resmi",
      url: "https://dokumen.example.test/panduan",
      content: "Cuplikan pertama",
      score: 0.96,
      raw_content: null,
    },
    {
      title: "Artikel kedua",
      url: "https://kedua.example.test/tulis",
      content: "Cuplikan kedua",
      score: 0.82,
    },
  ],
  reply,
  researchReply,
  replies,
  resultsByQuery,
  pages = {
    "dokumen.example.test":
      "<html><title>Panduan</title><body>Gunakan pengulangan berjenjang untuk menangani galat. Isi panduan.</body></html>",
    "kedua.example.test":
      "<html><title>Artikel</title><body>Catat kegagalan agar mudah diperiksa. Isi artikel.</body></html>",
    "ketiga.example.test":
      "<html><title>Ronde dua</title><body>Isi halaman ronde dua.</body></html>",
    "keempat.example.test":
      "<html><title>Ronde dua lagi</title><body>Isi halaman keempat.</body></html>",
  },
  searchStatus = 200,
  cacheRows = new Map(),
  gates = {},
  toolsStatus = 200,
  projectKind = "webapp",
  summaryReply,
}: Fixture = {}) {
  // The model's own passes, in the order the test scripts them.
  const chat: any[] = [];
  // Every provider call, the summary pass included: "how many calls" is never
  // answered from a filtered list.
  const calls: any[] = [];
  // Just the abstractive cross-page summary passes.
  const summaries: any[] = [];
  const rpcs: any[] = [];
  // Names of vendor calls whose request was aborted, so a test can prove that a
  // closed tab cancels a normal turn but not a background research job.
  const aborted: string[] = [];
  // Names of gated vendor calls that were actually reached, so a test can wait
  // for the exact moment worth acting on.
  const gated: string[] = [];
  const waitGate = (name: string, signal?: AbortSignal) => {
    const gate = gates[name as keyof typeof gates];
    if (!gate) return Promise.resolve();
    gated.push(name);
    return Promise.race([
      gate,
      new Promise<void>((_, reject) => {
        const stop = () => {
          aborted.push(name);
          reject(new Error("aborted"));
        };
        if (signal?.aborted) return stop();
        signal?.addEventListener("abort", stop, { once: true });
      }),
    ]);
  };
  // Every outbound vendor call, so a test can assert the real HTTP contract
  // instead of trusting the provider wrapper.
  const vendor: any[] = [];
  const fetcher = async (input: any, init: any = {}) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const path = url.pathname;
    const json = (data: any, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (path.endsWith("/chat/completions")) {
      await waitGate("chat", init.signal);
      const body = JSON.parse(init.body);
      calls.push(body);
      const sse = (content: string) =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      // The abstractive cross-page summary is its own model pass over the pages
      // already read. It is answered here from a scripted reply — never from the
      // pass chain — so a test that scripts rounds keeps counting only rounds.
      // The marker is the opening line of the summarization instruction, so the
      // summary pass is recognised by what the server asked for, not by order.
      if (
        /You are summarizing retrieved pages/.test(
          body.messages?.[0]?.content || "",
        )
      ) {
        summaries.push(body);
        const scriptedSummary = summaryReply ?? {
          summary:
            "Kedua halaman sama-sama menekankan pengulangan berjenjang dan pencatatan kegagalan.",
          covers: [1, 2],
          gaps: "",
        };
        return sse(
          typeof scriptedSummary === "string"
            ? scriptedSummary
            : JSON.stringify(scriptedSummary),
        );
      }
      chat.push(body);
      // A provider that does not know `tools` answers with an error instead of
      // pretending: the route has to cope with that, and this is where it is
      // proven.
      if (toolsStatus !== 200 && Array.isArray(body.tools) && body.tools.length)
        return new Response("tools not supported", { status: toolsStatus });
      // The fixture speaks one scripted reply per pass: a search request, then
      // another, then the answer, depending on what the test needs.
      const chain = replies?.length ? replies : [reply, researchReply];
      const scripted = chain[Math.min(chat.length - 1, chain.length - 1)];
      // A reply may be a native tool call, streamed the way OpenAI-compatible
      // providers stream them: the name once, the JSON arguments in fragments.
      if (Array.isArray(scripted?.__tool_calls)) {
        const lines: string[] = [];
        for (const [index, call] of scripted.__tool_calls.entries()) {
          const args =
            typeof call.arguments === "string"
              ? call.arguments
              : JSON.stringify(call.arguments ?? {});
          lines.push(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index,
                        id: call.id,
                        type: "function",
                        function: { name: call.name, arguments: "" },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          );
          for (let at = 0; at < args.length; at += 24)
            lines.push(
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index,
                          function: { arguments: args.slice(at, at + 24) },
                        },
                      ],
                    },
                  },
                ],
              })}\n\n`,
            );
        }
        lines.push("data: [DONE]\n\n");
        return new Response(lines.join(""), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return sse(JSON.stringify(scripted));
    }
    if (url.host === "api.tavily.com") {
      await waitGate("search", init.signal);
      vendor.push({
        url: url.href,
        method: init.method || "GET",
        headers: Object.fromEntries(
          Object.entries(init.headers || {}).map(([key, value]) => [
            key.toLowerCase(),
            String(value),
          ]),
        ),
        body: JSON.parse(init.body || "{}"),
      });
      if (searchStatus !== 200)
        return new Response("nope", { status: searchStatus });
      const query = String(JSON.parse(init.body || "{}").query || "");
      const match = Object.keys(resultsByQuery || {}).find((key) =>
        query.includes(key),
      );
      return json({ results: match ? resultsByQuery![match] : results });
    }
    if (path === "/auth/v1/user")
      return json({
        id: ids.member,
        email: "member@example.test",
        email_confirmed_at: "2026-01-01",
        user_metadata: {},
      });
    if (path === "/rest/v1/projects")
      return json([
        {
          id: url.searchParams.get("id")?.replace("eq.", ""),
          owner_id: ids.member,
          name: "Project uji",
          kind: projectKind,
        },
      ]);
    if (path === "/rest/v1/project_workspaces")
      return json({
        payload: {
          id: crypto.randomUUID(),
          kind: projectKind,
          name: "Project uji",
          files: {},
        },
        revision: 1,
      });
    if (path === "/rest/v1/runtime_search_cache") {
      const method = init.method || "GET";
      if (method === "POST") {
        for (const row of [].concat(JSON.parse(init.body || "[]")))
          cacheRows.set(row.key, row);
        return json([], 201);
      }
      // The filters the real table would apply: every `column=op.value`
      // condition (eq, gte, lt) is honoured, including range queries over the
      // `research-job:` key prefix that the job store uses.
      const filters: Array<[string, string, string]> = [];
      for (const [column, value] of url.searchParams.entries()) {
        const at = value.indexOf(".");
        if (at < 0) continue;
        filters.push([column, value.slice(0, at), value.slice(at + 1)]);
      }
      const matches = [...cacheRows.values()].filter((row) =>
        filters.every(([column, op, value]) => {
          const cell = String(row[column] ?? "");
          if (op === "eq") return cell === value;
          if (op === "gte") return cell >= value;
          if (op === "lt") return cell < value;
          return true;
        }),
      );
      if (method === "DELETE") {
        for (const row of matches) cacheRows.delete(row.key);
        return json([], 200);
      }
      return json(matches);
    }
    if (path.startsWith("/rest/v1/rpc/")) {
      const rpc = path.replace("/rest/v1/rpc/", "");
      rpcs.push({ rpc, body: JSON.parse(init.body) });
      return json({ remaining: 27, balance: 27 });
    }
    if (pages[url.hostname])
      return new Response(pages[url.hostname], {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    if (
      [
        "collaborators",
        "platform_project_controls",
        "platform_user_controls",
        "platform_admins",
      ].some((name) => path === `/rest/v1/${name}`)
    )
      return json([]);
    if (path === "/rest/v1/site_configuration")
      return json([{ revision: 1, value: defaultSite }]);
    throw new Error("Unexpected fixture query: " + path + url.search);
  };
  return {
    fetcher,
    chat,
    calls,
    summaries,
    rpcs,
    vendor,
    cacheRows,
    aborted,
    gated,
  };
}

async function serve(
  options: Fixture & {
    env?: Record<string, string>;
    research?: boolean;
    mode?: string;
    kind?: string;
    /** Same id across two instances, so a restart can be simulated. */
    projectId?: string;
  } = {},
) {
  const fx = fixture(options);
  const { app } = createApp({
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test",
      SUPABASE_SERVICE_ROLE_KEY: "server-test",
      LLM_BASE_URL: "https://provider.test/v1",
      LLM_API_KEY: "sk-test-placeholder-not-a-credential",
      LLM_MODEL: "deepseek-chat",
      ...(options.env || {}),
    },
    fetcher: fx.fetcher,
    // Offline DNS: every fixture host is treated as the public address below,
    // so the SSRF guard runs for real instead of being skipped.
    resolver: async () => [{ address: PUBLIC_IP, family: 4 }],
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((ready) => server.once("listening", ready));
  const projectId = options.projectId || crypto.randomUUID();
  const api =
    "http://127.0.0.1:" +
    (server.address() as any).port +
    "/api/projects/" +
    projectId;
  return { fx, server, api, projectId };
}

async function run(
  options: Fixture & {
    env?: Record<string, string>;
    research?: boolean;
    mode?: string;
    kind?: string;
    /** Files the browser sends; defaults to one saved Roblox scene. */
    files?: Record<string, string>;
  } = {},
) {
  const { fx, server, api } = await serve(options);
  const response = await fetch(api + "/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer member",
    },
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      prompt: "Cara menangani retry di Next.js App Router?",
      mode: options.mode || "Ask",
      model: "Otomatis",
      research: options.research !== false,
      files: options.files || { [SCENE_PATH]: savedScene() },
    }),
  });
  const text = await response.text();
  server.close();
  if (!response.ok && !text.startsWith("data:"))
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  const events = text
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  return { status: response.status, events, ...fx };
}

const resultOf = (events: any[]) =>
  events.find((e) => e.type === "result")?.result;

test("research end to end: sources are returned, cited and billed once", async () => {
  const { events, chat, calls, summaries, rpcs } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    reply: {
      content: "",
      ops: [
        { kind: "search", queries: ["next.js app router retry"], type: "web" },
      ],
    },
    researchReply: {
      content: "Pakai pengulangan berjenjang [1] dan catat kegagalan [2].",
    },
  });
  const result = resultOf(events);
  assert.ok(result, "the turn must finish with a result");
  assert.equal(result.sources.length, 2);
  assert.deepEqual(
    result.sources.map((s: any) => s.index),
    [1, 2],
  );
  assert.equal(result.sources[0].provider, "tavily");
  assert.match(result.sources[0].url, /^https:\/\/dokumen\.example\.test\//);
  // The report maps citations onto real sources; nothing is invented.
  assert.deepEqual(result.research.cited, [1, 2]);
  assert.deepEqual(result.research.uncited, []);
  assert.deepEqual(result.research.invalid, []);
  assert.equal(result.research.read, 2);
  // The cited sentences share real words with the pages that were read, so the
  // heuristic has nothing to report.
  assert.deepEqual(result.research.unsupported, []);
  assert.equal(result.research.groundingNotice, "");
  // The synthesis rides inside the round's credit, so the price is unchanged.
  assert.equal(result.creditsUsed, 2);
  // Three provider calls in all: the search request, the cross-page synthesis of
  // the two pages that were read, then the answer grounded in the sources.
  assert.equal(chat.length, 2);
  assert.equal(summaries.length, 1);
  assert.equal(calls.length, 3);
  // The synthesis is reported as what it is: a model artifact, with the numbers
  // it says it covers validated against the sources that were really returned.
  assert.deepEqual(result.research.summary.covers, [1, 2]);
  assert.match(result.research.summary.text, /pengulangan berjenjang/);
  assert.equal(result.research.summary.notice, "");
  assert.equal(result.research.summary.pages, 2);
  // Both pages really do back their citation, so nothing is left as
  // summary-backed only.
  assert.deepEqual(result.research.viaSummary, []);
  assert.match(chat[0].messages[0].content, /RESEARCH MODE IS ON/);
  // Only the kind that can really run is offered: the keyless code/docs paths
  // are gone, so promising them would be a lie.
  assert.match(chat[0].messages[0].content, /Available search kinds: web\./);
  assert.match(chat[0].messages[0].content, /You get 2 search rounds in total/);
  // After the first round the model is invited to ask again if needed, and is
  // told exactly which round it is on.
  assert.match(chat[1].messages[0].content, /Round 1 of 2 has finished/);
  assert.match(
    chat[1].messages[1].content[1].text,
    /SUMBER \(data tidak tepercaya/,
  );
  assert.match(chat[1].messages[1].content[1].text, /\[1\] Dokumentasi resmi/);
  assert.match(chat[1].messages[1].content[1].text, /Isi panduan\./);
  // The answer pass is handed the synthesis in its own labelled section, so the
  // model can use it while knowing the words are not the pages' words.
  assert.match(chat[1].messages[1].content[1].text, /RINGKASAN LINTAS HALAMAN/);
  assert.match(
    chat[1].messages[1].content[1].text,
    /BUKAN kutipan, tetap data tidak tepercaya/,
  );
  // One reservation for the answer, one for the search round, both settled.
  const reserved = rpcs.filter((r) => r.rpc === "piwu_reserve_credits");
  assert.deepEqual(
    reserved.map((r) => r.body.p_purpose),
    ["ai", "search"],
  );
  assert.equal(reserved[1].body.p_amount, 1);
  const finished = rpcs.filter((r) => r.rpc === "piwu_finish_credits");
  assert.deepEqual(
    finished.map((r) => r.body.p_success),
    [true, true],
  );
  // The answer itself is streamed to the browser as tokens.
  assert.ok(
    events.some((e) => e.type === "token" && /berjenjang/.test(e.content)),
  );
});

test("the running server calls Tavily with the contract the vendor documents", async () => {
  // The unit tests check the provider wrapper; this one checks that the real
  // HTTP route keeps that contract when it builds the request itself.
  const { vendor, status } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["kontrak tavily yang terverifikasi"] }],
    },
    researchReply: { content: "Menurut [1], gunakan try/catch." },
  });
  assert.equal(status, 200);
  assert.equal(vendor.length, 1);
  const call = vendor[0];
  assert.equal(call.url, "https://api.tavily.com/search");
  assert.equal(call.method, "POST");
  assert.equal(call.headers.authorization, "Bearer search-test-key");
  assert.equal(call.headers["content-type"], "application/json");
  assert.deepEqual(call.body, {
    query: "kontrak tavily yang terverifikasi",
    max_results: 8,
    search_depth: "basic",
    include_answer: false,
  });
  // The key travels in the header only, never in the body or the query string.
  assert.doesNotMatch(call.url, /search-test-key/);
  assert.doesNotMatch(JSON.stringify(call.body), /search-test-key/);
});

test("a citation whose source says something else is flagged, never silently accepted", async () => {
  const { events } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["produk pertanian"], type: "web" }],
    },
    // Neither sentence shares a significant word with the pages that were read.
    researchReply: {
      content: "Harga emas naik tajam [1] dan panen kopi menurun [2].",
    },
  });
  const result = resultOf(events);
  assert.deepEqual(result.research.cited, [1, 2]);
  assert.deepEqual(result.research.unsupported, [1, 2]);
  assert.match(result.research.groundingNotice, /Pemeriksaan heuristik/);
  assert.match(result.research.groundingNotice, /1, 2/);
});

const waitFor = async (check: () => boolean, what: string, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Batas waktu menunggu " + what);
};

// A research turn is long and paid for, so closing the tab must not throw it
// away: the rounds keep running and the answer waits for the same account.
test("research survives a closed tab and is delivered once when the client returns", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requestId = crypto.randomUUID();
  const { fx, server, api } = await serve({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    gates: { search: gate },
    reply: {
      content: "Sebentar, saya cari dulu.",
      ops: [{ kind: "search", queries: ["riset latar belakang"], type: "web" }],
    },
    researchReply: {
      content: "Gunakan pengulangan berjenjang [1] dan catat kegagalan [2].",
    },
  });
  const asMember = { Authorization: "Bearer member" };
  try {
    const controller = new AbortController();
    const response = await fetch(api + "/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asMember },
      signal: controller.signal,
      body: JSON.stringify({
        requestId,
        prompt: "Riset latar belakang soal retry",
        mode: "Ask",
        model: "Otomatis",
        research: true,
        files: { [SCENE_PATH]: savedScene() },
      }),
    });
    assert.equal(response.status, 200);
    await waitFor(() => fx.gated.includes("search"), "pencarian dimulai");
    // The tab closes while the provider is still answering.
    controller.abort();
    release();
    // The turn is not cancelled: the second pass still runs and settles.
    await waitFor(() => fx.chat.length === 2, "pass kedua");
    assert.equal(fx.aborted.includes("search"), false);

    let job: any = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !job) {
      const listed = await (
        await fetch(api + "/ai/jobs", { headers: asMember })
      ).json();
      job = listed.jobs.find(
        (entry: any) =>
          entry.requestId === requestId && entry.state === "ready",
      );
      if (!job) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!job) {
      // Report what the server still holds instead of a bare assertion failure.
      const listed = await (
        await fetch(api + "/ai/jobs", { headers: asMember })
      ).json();
      assert.fail(
        "riset latar belakang harus selesai sendiri: " + JSON.stringify(listed),
      );
    }
    assert.equal(job.result.sources.length, 2);
    assert.deepEqual(job.result.research.cited, [1, 2]);
    // One credit for the answer plus one for the round that added sources.
    assert.equal(job.result.creditsUsed, 2);
    assert.match(job.prompt, /^Riset latar belakang/);
    assert.ok(
      fx.rpcs.some(
        (r) => r.rpc === "piwu_finish_credits" && r.body.p_success === true,
      ),
      "pekerjaan yang selesai tetap dibayar sekali",
    );

    // Collected exactly once: the answer cannot be applied twice.
    const taken = await fetch(api + "/ai/jobs/" + requestId, {
      method: "DELETE",
      headers: asMember,
    });
    assert.equal(taken.status, 200);
    assert.equal((await taken.json()).job.requestId, requestId);
    const again = await fetch(api + "/ai/jobs/" + requestId, {
      method: "DELETE",
      headers: asMember,
    });
    assert.equal(again.status, 404);
    const after = await (
      await fetch(api + "/ai/jobs", { headers: asMember })
    ).json();
    assert.deepEqual(after.jobs, []);
  } finally {
    server.close();
  }
});

test("a closed tab still stops an ordinary turn and refunds it", async () => {
  // The provider never answers: the early keep-alive probe is what makes the
  // dead socket surface, and that cancels the turn instead of paying for work
  // nobody can receive.
  const gate = new Promise<void>(() => {});
  const { fx, server, api } = await serve({
    gates: { chat: gate },
    reply: { content: "Tidak akan pernah sampai." },
  });
  const asMember = { Authorization: "Bearer member" };
  try {
    const controller = new AbortController();
    const response = await fetch(api + "/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asMember },
      signal: controller.signal,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        prompt: "Perbaiki atap",
        mode: "Ask",
        model: "Otomatis",
        research: false,
        files: { [SCENE_PATH]: savedScene() },
      }),
    });
    assert.equal(response.status, 200);
    await waitFor(() => fx.gated.includes("chat"), "provider mulai menjawab");
    controller.abort();
    await waitFor(
      () => fx.aborted.includes("chat"),
      "panggilan provider dibatalkan",
    );
    await waitFor(
      () =>
        fx.rpcs.some(
          (r) => r.rpc === "piwu_finish_credits" && r.body.p_success === false,
        ),
      "kredit dikembalikan",
    );
    assert.ok(
      fx.rpcs.some(
        (r) => r.rpc === "piwu_reserve_credits" && r.body.p_purpose === "ai",
      ),
    );
    const listed = await (
      await fetch(api + "/ai/jobs", { headers: asMember })
    ).json();
    assert.deepEqual(listed.jobs, []);
  } finally {
    server.close();
  }
});

test("two server instances share one cached search instead of paying twice", async () => {
  // One fake table, two independent apps (two `createApp` calls), same query.
  const cacheRows = new Map<string, any>();
  const first = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    cacheRows,
    reply: {
      content: "",
      ops: [
        {
          kind: "search",
          queries: ["cache bersama lintas instance"],
          type: "web",
        },
      ],
    },
    researchReply: { content: "Catatan [1]." },
  });
  assert.equal(first.vendor.length, 1);
  assert.equal(resultOf(first.events).research.rounds[0].cached, false);
  assert.equal(resultOf(first.events).research.rounds[0].cache, "shared");
  // Two kinds of rows live in that table: the cached search, and the finished
  // research answer (which is what makes it survive a restart).
  const cachedKeys = [...cacheRows.keys()].filter(
    (key) => !key.startsWith("research-job:"),
  );
  assert.equal(cachedKeys.length, 1);
  assert.equal(
    [...cacheRows.keys()].filter((key) => key.startsWith("research-job:"))
      .length,
    1,
  );

  // A different instance has its own memory: only the table carries over.
  resetSearchCache();
  const second = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    cacheRows,
    reply: {
      content: "",
      ops: [
        {
          kind: "search",
          queries: ["cache bersama lintas instance"],
          type: "web",
        },
      ],
    },
    researchReply: { content: "Catatan [1]." },
  });
  // The second instance answers from the shared row: no vendor call at all.
  assert.equal(second.vendor.length, 0);
  assert.equal(resultOf(second.events).research.rounds[0].cached, true);
  assert.equal(resultOf(second.events).sources.length, 2);
});

test("two rounds are numbered 1..4, billed one credit each and closed honestly", async () => {
  const { events, chat, rpcs } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    resultsByQuery: {
      "ronde dua": [
        {
          title: "Halaman ronde dua",
          url: "https://ketiga.example.test/dua",
          content: "Cuplikan ketiga",
        },
        {
          title: "Halaman ronde dua lagi",
          url: "https://keempat.example.test/dua",
          content: "Cuplikan keempat",
        },
      ],
    },
    replies: [
      {
        content: "",
        ops: [{ kind: "search", queries: ["ronde satu"], type: "web" }],
      },
      // The second pass is still a search request, so a second round runs.
      {
        content: "",
        ops: [{ kind: "search", queries: ["ronde dua"], type: "web" }],
      },
      { content: "Jawaban memakai [1] dan [3]." },
    ],
  });
  const result = resultOf(events);
  assert.ok(result, "the turn must finish with a result");
  // Sources keep one numbering across rounds, so [3] really is the third one.
  assert.deepEqual(
    result.sources.map((s: any) => s.index),
    [1, 2, 3, 4],
  );
  assert.match(result.sources[2].url, /^https:\/\/ketiga\.example\.test\//);
  assert.equal(new Set(result.sources.map((s: any) => s.url)).size, 4);
  assert.equal(result.research.rounds.length, 2);
  assert.deepEqual(result.research.cited, [1, 3]);
  assert.deepEqual(result.research.uncited, [2, 4]);
  assert.equal(result.research.read, 4);
  // One credit for the answer plus one per round that returned sources.
  assert.equal(result.creditsUsed, 3);
  assert.equal(chat.length, 3);
  const finalSystem = chat[2].messages[0].content;
  assert.match(finalSystem, /Round 2 of 2 has finished/);
  assert.match(finalSystem, /No further search is possible/);
  assert.match(chat[2].messages[1].content[1].text, /\[3\] Halaman ronde dua/);
  const reserved = rpcs.filter((r) => r.rpc === "piwu_reserve_credits");
  assert.deepEqual(
    reserved.map((r) => r.body.p_purpose),
    ["ai", "search", "search"],
  );
  assert.notEqual(reserved[1].body.p_id, reserved[2].body.p_id);
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_finish_credits")
      .map((r) => r.body.p_success),
    [true, true, true],
  );
});

test("a request after the last allowed round is answered with the sources, not a fake reply", async () => {
  const { events, chat, rpcs } = await run({
    env: {
      SEARCH_PROVIDER: "tavily",
      SEARCH_API_KEY: "search-test-key",
      SEARCH_ROUNDS_MAX: "1",
    },
    replies: [
      {
        content: "Saya cari dulu.",
        ops: [{ kind: "search", queries: ["ronde satu"], type: "web" }],
      },
      // The model keeps asking although the cap is reached.
      {
        content: "",
        ops: [{ kind: "search", queries: ["ronde dua"], type: "web" }],
      },
    ],
  });
  const result = resultOf(events);
  assert.equal(
    events.find((e) => e.type === "error"),
    undefined,
  );
  // The sources are still delivered, with a plain explanation instead of the
  // model's request being shown as an answer.
  assert.equal(result.sources.length, 2);
  assert.match(result.content, /Saya cari dulu\./);
  assert.match(
    result.content,
    /belum menyusun jawaban akhir dalam batas ronde/,
  );
  assert.match(result.research.notice, /Ronde riset habis \(1\)/);
  assert.match(
    result.research.notice,
    /masih meminta langkah riset setelah batas/,
  );
  assert.equal(result.creditsUsed, 2);
  assert.equal(chat.length, 2);
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_reserve_credits")
      .map((r) => r.body.p_purpose),
    ["ai", "search"],
  );
});

test("research fails closed when search is switched off server-side", async () => {
  const { events, chat, rpcs } = await run({
    env: { SEARCH_ENABLED: "false" },
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["cuaca hari ini"], type: "web" }],
    },
    researchReply: { content: "tidak boleh sampai sini" },
  });
  assert.equal(resultOf(events), undefined);
  const error = events.find((e) => e.type === "error");
  // The kill switch says what it is, instead of blaming a missing configuration.
  assert.match(error.message, /SEARCH_ENABLED=false/);
  assert.equal(chat.length, 1);
  // Nothing was searched, so the only settlement is the refunded answer.
  const reserved = rpcs.filter((r) => r.rpc === "piwu_reserve_credits");
  assert.deepEqual(
    reserved.map((r) => r.body.p_purpose),
    ["ai"],
  );
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_finish_credits")
      .map((r) => r.body.p_success),
    [false],
  );
});

test("a research request without any provider fails closed instead of answering ungrounded", async () => {
  // The keyless paths are gone, so "web search without a web provider" now means
  // "no provider at all": the turn stops with an actionable 503 rather than
  // answering as if it had looked something up.
  const { events, chat, rpcs } = await run({
    env: { SEARCH_PROVIDER: "none" },
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["cuaca hari ini"], type: "web" }],
    },
    researchReply: { content: "tidak boleh sampai sini" },
  });
  assert.equal(resultOf(events), undefined);
  const error = events.find((e) => e.type === "error");
  assert.equal(error.status || 503, 503);
  assert.match(error.message, /belum ada provider pencarian/);
  assert.match(error.message, /SEARCH_PROVIDER dan SEARCH_API_KEY/);
  // One provider pass: the search request was refused before any round ran.
  assert.equal(chat.length, 1);
  // The answer credit comes back, and no search round was ever reserved.
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_reserve_credits")
      .map((r) => r.body.p_purpose),
    ["ai"],
  );
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_finish_credits")
      .map((r) => r.body.p_success),
    [false],
  );
});

test("a round that finds nothing is not billed and is reported honestly", async () => {
  const { events, rpcs } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    results: [],
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["topik langka"], type: "web" }],
    },
    researchReply: { content: "Sepertinya ini dijelaskan di [1]." },
  });
  const result = resultOf(events);
  assert.equal(result.sources, undefined);
  assert.equal(result.creditsUsed, 1);
  assert.equal(result.research.sources.length, 0);
  assert.equal(result.research.rounds.length, 1);
  assert.equal(result.research.rounds[0].count, 0);
  assert.match(result.research.notice, /Tidak ada sumber/);
  // A citation the server never returned is flagged, not resolved.
  assert.deepEqual(result.research.invalid, [1]);
  assert.deepEqual(result.research.cited, []);
  assert.match(result.research.citationNotice, /tidak mengutip/);
  // Still only one credit-bearing call: the answer.
  const finished = rpcs.filter((r) => r.rpc === "piwu_finish_credits");
  assert.deepEqual(
    finished.map((r) => r.body.p_success),
    [false, true],
  );
});

test("a search request outside research mode is refused, never applied as a scene edit", async () => {
  const { events } = await run({
    research: false,
    mode: "Builder",
    reply: {
      content: "Saya cari dulu.",
      ops: [{ kind: "search", queries: ["cara membuat pintu"] }],
    },
  });
  assert.equal(resultOf(events), undefined);
  const error = events.find((e) => e.type === "error");
  assert.match(error.message, /mode riset tidak aktif/);
});

test("research mode without any request for sources answers normally, unbilled by tools", async () => {
  const { events, chat, rpcs } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    reply: { content: "Ini jawaban langsung tanpa perlu mencari." },
  });
  const result = resultOf(events);
  assert.equal(chat.length, 1);
  assert.equal(result.creditsUsed, 1);
  assert.equal(result.sources, undefined);
  assert.equal(result.research, undefined);
  // No search work happened, so no search reservation may exist at all.
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_reserve_credits")
      .map((r) => r.body.p_purpose),
    ["ai"],
  );
});

test("native tool calling: the model calls a tool, and the sources come back numbered", async () => {
  const { events, chat, rpcs } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    replies: [
      {
        __tool_calls: [
          {
            id: "call_1",
            name: "search",
            arguments: { queries: ["retry next.js"] },
          },
        ],
      },
      { content: "Pakai pengulangan berjenjang [1] agar galat terlihat." },
    ],
  });
  const result = resultOf(events);
  // The tool schema really travelled to the provider, with the loop's rules: the
  // research tools plus the read-only server tools every turn gets. The dry run
  // is absent because this is not a Roblox Builder turn.
  assert.deepEqual(
    chat[0].tools.map((tool: any) => tool.function.name),
    ["search", "read_page", "list_files", "read_file"],
  );
  assert.equal(chat[0].tool_choice, "auto");
  assert.match(chat[0].messages[0].content, /CALL the provided tools/);
  // The tool result comes back as a tool message, matched to its call id, so a
  // provider that speaks tool calling sees a valid conversation.
  const toolMessage = chat[1].messages.find((m: any) => m.role === "tool");
  assert.equal(toolMessage.tool_call_id, "call_1");
  assert.match(toolMessage.content, /\[1\] Dokumentasi resmi/);
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.research.cited, [1]);
  // One search round, one credit, plus the model's own cost.
  assert.equal(result.creditsUsed, 2);
  // The browser was told what was happening while it waited.
  assert.deepEqual(
    events.filter((e) => e.type === "step").map((e) => e.step.phase),
    // The synthesis of the two pages read runs between the read and the answer.
    ["search", "read", "summary"],
  );
});

test("read_page opens a page the model found, and it becomes a numbered source", async () => {
  const { events, chat, rpcs } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    pages: {
      "kelima.example.test":
        "<html><title>Catatan retry</title><body>Backoff eksponensial mencegah badai percobaan ulang.</body></html>",
    },
    replies: [
      {
        __tool_calls: [
          {
            id: "call_buka",
            name: "read_page",
            arguments: { url: "https://kelima.example.test/catatan" },
          },
        ],
      },
      { content: "Backoff eksponensial dianjurkan [1]." },
    ],
  });
  const result = resultOf(events);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].index, 1);
  // The source list says who opened it, instead of pretending a search found it.
  assert.equal(result.sources[0].provider, "dibuka langsung");
  assert.match(result.sources[0].title, /Catatan retry/);
  assert.equal(result.research.read, 1);
  assert.match(
    chat[1].messages.find((m: any) => m.role === "tool").content,
    /Backoff eksponensial/,
  );
  // Opening a page costs nothing beyond the model call.
  assert.equal(result.creditsUsed, 1);
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_reserve_credits")
      .map((r) => r.body.p_purpose),
    ["ai"],
  );
  assert.deepEqual(
    events.filter((e) => e.type === "step").map((e) => e.step.phase),
    ["open"],
  );
});

test("a provider without tool support is retried in the ops protocol, never billed twice", async () => {
  const { events, chat, rpcs } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    // This provider answers 400 when the request carries tools, so the first
    // pass costs two calls: the rejected one and the retry in the ops protocol.
    toolsStatus: 400,
    replies: [
      {
        content: "",
        ops: [{ kind: "search", queries: ["retry next.js"], type: "web" }],
      },
      {
        content: "",
        ops: [{ kind: "search", queries: ["retry next.js"], type: "web" }],
      },
      { content: "Pakai backoff eksponensial [1]." },
    ],
  });
  const result = resultOf(events);
  assert.ok(chat[0].tools.length);
  assert.equal(chat[1].tools, undefined);
  // The retry is still the same pass and the same credit.
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_reserve_credits")
      .map((r) => r.body.p_purpose),
    ["ai", "search"],
  );
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_finish_credits")
      .map((r) => r.body.p_success),
    [true, true],
  );
  assert.equal(result.creditsUsed, 2);
  assert.equal(result.sources.length, 2);
  assert.match(result.research.notice, /tidak menerima tool-calling/);
  // The fallback still teaches the JSON protocol, not the tools it cannot use.
  assert.match(chat[1].messages[0].content, /"kind":"search"/);
});

test("an unknown tool is refused by name, and a turn that never answers fails honestly", async () => {
  const { events, chat, rpcs, vendor } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    replies: [
      {
        __tool_calls: [
          { id: "call_x", name: "hapus_semua_data", arguments: {} },
        ],
      },
    ],
  });
  const error = events.find((e) => e.type === "error");
  assert.match(error.message, /hapus_semua_data/);
  assert.equal(resultOf(events), undefined);
  // The refusal is an answer, not silence: the model is told by name what the
  // server really has, so a model that can answer does.
  const refused = chat[1].messages.find((m: any) => m.role === "tool");
  assert.equal(refused.tool_call_id, "call_x");
  assert.match(
    refused.content,
    /"hapus_semua_data" tidak dikenal di server ini/,
  );
  assert.match(refused.content, /list_files, read_file/);
  // Nothing was searched, and the credits went back.
  assert.equal(vendor.length, 0);
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_finish_credits")
      .map((r) => r.body.p_success),
    [false],
  );
  // Two refusal rounds inside the budget, then the pass that still only called
  // the tool: the loop stopped there instead of running forever.
  assert.equal(chat.length, 3);
});

test("the round cap stops a model that keeps calling tools, and no answer is invented", async () => {
  const { events, rpcs } = await run({
    env: {
      SEARCH_PROVIDER: "tavily",
      SEARCH_API_KEY: "search-test-key",
      SEARCH_ROUNDS_MAX: "1",
    },
    replies: [
      {
        __tool_calls: [
          {
            id: "call_1",
            name: "search",
            arguments: { queries: ["retry next.js"] },
          },
        ],
      },
      // The cap is reached, and the model asks for another round anyway.
      {
        __tool_calls: [
          {
            id: "call_2",
            name: "search",
            arguments: { queries: ["retry lagi"] },
          },
        ],
      },
    ],
  });
  const result = resultOf(events);
  // The sources that were collected are still delivered, with a plain reason
  // instead of the model's tool call read as prose.
  assert.equal(result.sources.length, 2);
  assert.match(result.content, /belum menyusun jawaban akhir/);
  assert.match(
    result.research.notice,
    /masih meminta langkah riset setelah batas/,
  );
  // Only the one allowed round was billed, and no second search was run.
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_reserve_credits")
      .map((r) => r.body.p_purpose),
    ["ai", "search"],
  );
});

test("a finished research answer survives a server restart and is collected once", async () => {
  const cacheRows = new Map<string, any>();
  const requestId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const asMember = { Authorization: "Bearer member" };
  // Same project, same table, two processes: that is a restart.
  const options = {
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    cacheRows,
    projectId,
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["riset tahan restart"], type: "web" }],
    },
    researchReply: { content: "Pakai backoff eksponensial [1]." },
  };
  const first = await serve(options);
  try {
    const response = await fetch(first.api + "/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asMember },
      body: JSON.stringify({
        requestId,
        prompt: "Riset soal retry",
        mode: "Ask",
        model: "Otomatis",
        research: true,
        files: { [SCENE_PATH]: savedScene() },
      }),
    });
    assert.equal(response.status, 200);
    await response.text();
    // The finished answer is mirrored under its own key, next to the cached
    // search rows and not inside them.
    assert.deepEqual(
      [...cacheRows.keys()].filter((key) => key.startsWith("research-job:")),
      ["research-job:" + projectId + ":" + requestId],
    );
  } finally {
    first.server.close();
  }

  // A brand-new process with no memory at all: only the shared table knows.
  const second = await serve(options);
  try {
    const listed = await (
      await fetch(second.api + "/ai/jobs", { headers: asMember })
    ).json();
    assert.equal(listed.jobs.length, 1);
    assert.equal(listed.jobs[0].state, "ready");
    assert.equal(listed.jobs[0].requestId, requestId);
    assert.equal(
      listed.jobs[0].result.content,
      "Pakai backoff eksponensial [1].",
    );
    assert.equal(listed.jobs[0].creditsUsed, 2);

    const claimed = await fetch(second.api + "/ai/jobs/" + requestId, {
      method: "DELETE",
      headers: asMember,
    });
    assert.equal(claimed.status, 200);
    assert.equal((await claimed.json()).job.requestId, requestId);
    // The row is gone, so a later visit cannot hand the same answer over twice.
    assert.equal(
      [...cacheRows.keys()].filter((key) => key.startsWith("research-job:"))
        .length,
      0,
    );
    const again = await fetch(second.api + "/ai/jobs/" + requestId, {
      method: "DELETE",
      headers: asMember,
    });
    assert.equal(again.status, 404);
  } finally {
    second.server.close();
  }
});

test("a finished answer is never handed to another account or project", async () => {
  const cacheRows = new Map<string, any>();
  const requestId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const owned = {
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    cacheRows,
    projectId,
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["milik satu akun"], type: "web" }],
    },
    researchReply: { content: "Catatan [1]." },
  };
  const first = await serve(owned);
  try {
    const response = await fetch(first.api + "/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer member",
      },
      body: JSON.stringify({
        requestId,
        prompt: "Riset milik akun ini",
        mode: "Ask",
        model: "Otomatis",
        research: true,
        files: { [SCENE_PATH]: savedScene() },
      }),
    });
    await response.text();
  } finally {
    first.server.close();
  }

  // Another project of the same account: the row is out of range.
  const otherProject = await serve({
    ...owned,
    projectId: crypto.randomUUID(),
  });
  try {
    const listed = await (
      await fetch(otherProject.api + "/ai/jobs", {
        headers: { Authorization: "Bearer member" },
      })
    ).json();
    assert.deepEqual(listed.jobs, []);
    const claim = await fetch(otherProject.api + "/ai/jobs/" + requestId, {
      method: "DELETE",
      headers: { Authorization: "Bearer member" },
    });
    assert.equal(claim.status, 404);
  } finally {
    otherProject.server.close();
  }
  // The answer is still there, exactly once, for the project that owns it.
  assert.deepEqual(
    [...cacheRows.keys()].filter((key) => key.startsWith("research-job:")),
    ["research-job:" + projectId + ":" + requestId],
  );
});

// The general tool layer is what makes tool calling an ordinary feature: the
// server reads the project the browser already sent, spends nothing, and reports
// exactly which tools ran, which refused, and why.
test("an ordinary turn may list and read the project files without cost or network", async () => {
  const { events, chat, rpcs, vendor } = await run({
    research: false,
    files: { "src/app.tsx": "satu\ndua\ntiga", "README.md": "rahasia proyek" },
    replies: [
      { __tool_calls: [{ id: "c1", name: "list_files", arguments: {} }] },
      {
        __tool_calls: [
          {
            id: "c2",
            name: "read_file",
            arguments: { path: "src/app.tsx", from: 2, lines: 1 },
          },
        ],
      },
      { content: 'Baris 2 berkas itu berisi "dua".' },
    ],
  });
  const result = resultOf(events);
  assert.ok(result, "the turn must finish with a result");
  // No research in this turn, so no research tool is promised — and the read-only
  // pair is offered in a mode that never had tools before.
  assert.deepEqual(
    chat[0].tools.map((tool: any) => tool.function.name),
    ["list_files", "read_file"],
  );
  // The listing is an index: the file that holds a secret is named, not opened.
  const listed = chat[1].messages.find((m: any) => m.role === "tool");
  assert.equal(listed.tool_call_id, "c1");
  assert.match(listed.content, /FILE PROJECT \(2 file, hanya daftar isi/);
  assert.match(listed.content, /- README\.md — 1 baris/);
  assert.doesNotMatch(listed.content, /rahasia proyek/);
  // The window the model asked for comes back numbered, and nothing more.
  const read = chat[2].messages
    .filter((m: any) => m.role === "tool")
    .find((m: any) => m.tool_call_id === "c2");
  assert.match(read.content, /src\/app\.tsx baris 2–2:/);
  assert.match(read.content, /2\| dua/);
  assert.doesNotMatch(read.content, /tiga/);
  // One credit for the model, none for the tools, and no vendor was called.
  assert.equal(result.creditsUsed, 1);
  assert.deepEqual(
    rpcs
      .filter((r) => r.rpc === "piwu_reserve_credits")
      .map((r) => r.body.p_purpose),
    ["ai"],
  );
  assert.equal(vendor.length, 0);
  // The reply says what really ran, and claims nothing else.
  assert.deepEqual(result.tools.calls, [
    { name: "list_files", ok: true },
    { name: "read_file", ok: true },
  ]);
  assert.equal(result.tools.rounds, 2);
  assert.deepEqual(result.tools.refused, []);
  assert.match(result.tools.notice, /tanpa kredit, tanpa jaringan/);
  assert.deepEqual(
    events.filter((e) => e.type === "step").map((e) => e.step.phase),
    ["tool", "tool"],
  );
  assert.equal(result.sources, undefined);
  assert.equal(result.research, undefined);
});

test("a tool the server does not have is refused by name, and the answer still comes", async () => {
  const { events, chat } = await run({
    research: false,
    replies: [
      {
        __tool_calls: [
          {
            id: "c1",
            name: "curl_the_web",
            arguments: { url: "https://x.example.test" },
          },
        ],
      },
      { content: "Saya tidak punya alat itu, jadi saya jawab dari yang ada." },
    ],
  });
  const result = resultOf(events);
  const refused = chat[1].messages.find((m: any) => m.role === "tool");
  assert.match(refused.content, /"curl_the_web" tidak dikenal di server ini/);
  assert.match(refused.content, /list_files, read_file/);
  // Named in the report, so a refused call is never silent.
  assert.deepEqual(result.tools.refused, ["curl_the_web"]);
  assert.deepEqual(result.tools.calls, [{ name: "curl_the_web", ok: false }]);
  assert.equal(result.tools.rounds, 1);
  assert.match(result.tools.notice, /curl_the_web/);
});

test("search and read_page outside research mode are refused, and nothing is fetched", async () => {
  const { events, chat, vendor } = await run({
    research: false,
    replies: [
      {
        __tool_calls: [
          {
            id: "c1",
            name: "search",
            arguments: { queries: ["cuaca hari ini"] },
          },
        ],
      },
      { content: "Tanpa mode riset saya tidak bisa mencari sumber." },
    ],
  });
  const result = resultOf(events);
  const refused = chat[1].messages.find((m: any) => m.role === "tool");
  assert.match(refused.content, /Pencarian sumber hanya aktif saat mode riset/);
  // The point of the refusal: no vendor call, no source, no credit.
  assert.equal(vendor.length, 0);
  assert.equal(result.sources, undefined);
  assert.equal(result.research, undefined);
  assert.equal(result.creditsUsed, 1);
});

test("dry_run_ops is offered only in a Roblox Builder turn, and the trial writes nothing", async () => {
  const scene = savedScene();
  const files: Record<string, string> = { [SCENE_PATH]: scene };
  const batch = {
    ops: [
      {
        kind: "scene.transform",
        ops: [{ target: "obj-rumah", move: [3, 0, 0] }],
      },
    ],
  };
  const builder = await run({
    projectKind: "roblox",
    mode: "Builder",
    research: false,
    files,
    replies: [
      { __tool_calls: [{ id: "c1", name: "dry_run_ops", arguments: batch }] },
      { content: "Rencana: geser Rumah 3 stud ke kanan." },
    ],
  });
  assert.deepEqual(
    builder.chat[0].tools.map((tool: any) => tool.function.name),
    ["list_files", "read_file", "dry_run_ops"],
  );
  const trial = builder.chat[1].messages.find((m: any) => m.role === "tool");
  assert.match(trial.content, /Uji coba berhasil: 1 operasi akan diterapkan/);
  assert.match(trial.content, /tidak ada yang ditulis ke project/);
  // The scene the browser sent is byte-identical: a trial is read-only.
  assert.equal(files[SCENE_PATH], scene);
  const builderResult = resultOf(builder.events);
  assert.deepEqual(builderResult.tools.calls, [
    { name: "dry_run_ops", ok: true },
  ]);
  assert.equal(builderResult.files, undefined);

  // The same project in Ask mode: the tool is not promised, and a call to it is
  // refused with the reason instead of a fabricated result.
  const ask = await run({
    projectKind: "roblox",
    mode: "Ask",
    research: false,
    files: { [SCENE_PATH]: savedScene() },
    replies: [
      { __tool_calls: [{ id: "c2", name: "dry_run_ops", arguments: batch }] },
      { content: "Mode Ask tidak mengubah scene." },
    ],
  });
  assert.deepEqual(
    ask.chat[0].tools.map((tool: any) => tool.function.name),
    ["list_files", "read_file"],
  );
  const refused = ask.chat[1].messages.find((m: any) => m.role === "tool");
  assert.match(refused.content, /hanya berlaku di mode Builder/);
  assert.deepEqual(resultOf(ask.events).tools.refused, ["dry_run_ops"]);
});

test("the tool rounds are capped, and a model that only calls tools is answered honestly", async () => {
  const { events, calls } = await run({
    env: { TOOL_ROUNDS_MAX: "2" },
    research: false,
    replies: [
      { __tool_calls: [{ id: "c1", name: "list_files", arguments: {} }] },
    ],
  });
  // No answer ever arrived, so the turn fails with the tools named instead of
  // being answered with prose the model never wrote.
  assert.equal(resultOf(events), undefined);
  const error = events.find((e) => e.type === "error");
  assert.match(error.message, /list_files/);
  assert.match(error.message, /tanpa menyusun jawaban/);
  assert.match(error.message, /Kredit dikembalikan/);
  // Three passes: two allowed tool rounds, then the pass that still only called
  // a tool — the loop stopped there rather than running forever.
  assert.equal(calls.length, 3);
});

test("an invented link or number in the synthesis is removed or reported, never resolved", async () => {
  const { events, chat } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["retry next.js"], type: "web" }],
    },
    researchReply: { content: "Pakai pengulangan berjenjang [1]." },
    summaryReply: {
      summary: "Menurut [9] dan https://jahat.example.test/z, retry itu rumit.",
      covers: [1, 9],
      gaps: "Tidak ada sumber soal biaya.",
    },
  });
  const result = resultOf(events);
  const summary = result.research.summary;
  // A URL that is not one of the sources never reaches the answer pass.
  assert.doesNotMatch(summary.text, /jahat\.example\.test/);
  assert.doesNotMatch(
    chat[1].messages[1].content[1].text,
    /jahat\.example\.test/,
  );
  // The ghost number is reported, not turned into a source, and the cover list
  // only keeps numbers that really exist.
  assert.deepEqual(summary.invalid, [9]);
  assert.deepEqual(summary.covers, [1]);
  assert.match(
    summary.notice,
    /nomor sumber yang tidak pernah dikembalikan: 9/,
  );
  assert.match(summary.notice, /Tautan yang bukan salah satu sumber dihapus/);
  assert.equal(summary.gaps, "Tidak ada sumber soal biaya.");
});

test("a citation only the AI synthesis supports is marked as summary-backed", async () => {
  const { events } = await run({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: "search-test-key" },
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["retry next.js"], type: "web" }],
    },
    summaryReply: {
      summary: "Sumber menyarankan backoff eksponensial berlapis.",
      covers: [1],
      gaps: "",
    },
    researchReply: { content: "Pakai backoff eksponensial berlapis [1]." },
  });
  const result = resultOf(events);
  // The page text does not contain those words, so the citation is not reported
  // as page-supported — it is reported as what it is.
  assert.deepEqual(result.research.viaSummary, [1]);
  assert.deepEqual(result.research.unsupported, []);
  assert.match(result.research.groundingNotice, /hanya didukung ringkasan AI/);
});

test("the cross-page synthesis can be switched off, and then no pass is spent on it", async () => {
  const { events, calls, summaries } = await run({
    env: {
      SEARCH_PROVIDER: "tavily",
      SEARCH_API_KEY: "search-test-key",
      RESEARCH_SUMMARY: "false",
    },
    reply: {
      content: "",
      ops: [{ kind: "search", queries: ["retry next.js"], type: "web" }],
    },
    researchReply: { content: "Pakai pengulangan berjenjang [1]." },
  });
  const result = resultOf(events);
  assert.equal(summaries.length, 0);
  // Two passes: the search request and the grounded answer, nothing more.
  assert.equal(calls.length, 2);
  assert.equal(result.research.summary, undefined);
  assert.equal(result.creditsUsed, 2);
});
