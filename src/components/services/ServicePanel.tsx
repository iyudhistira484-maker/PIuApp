import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, projectApi, readAttachment } from "../../services/api";
import { useStore } from "../../lib/store";
import "./services.css";
export default function ServicePanel({
  kind,
  projectId,
  onReference,
}: {
  kind: string;
  projectId: string;
  onReference?: (url: string, title: string) => void;
}) {
  const user = useStore((s) => s.user),
    role = useStore((s) => s.sync[projectId]?.role);
  const [status, setStatus] = useState<any>(null),
    [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [value, setValue] = useState(""),
    [secondary, setSecondary] = useState(""),
    [option, setOption] = useState("Viewer"),
    [secretValue, setSecretValue] = useState(""),
    [environment, setEnvironment] = useState("dev"),
    [confirmed, setConfirmed] = useState(false);
  const owner = role === "Owner",
    editor = owner || role === "Editor",
    cloud = Boolean(user && !user.demo && status?.capabilities?.cloud);
  const files = useStore(
    (s) => s.projects.find((p) => p.id === projectId)?.files,
  );
  const projectKind = useStore(
    (s) => s.projects.find((p) => p.id === projectId)?.kind || "webapp",
  );
  const webRuntime = projectKind === "webapp";
  let installed: Record<string, string> = {};
  try {
    const pkg = JSON.parse(files?.["package.json"] || "{}");
    installed = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {}
  const routes: Record<string, string> = {
    invite: "members",
    security: "audits",
    secrets: "secrets",
    assets: "assets",
    comments: "comments",
  };
  const request = (path: string, body?: unknown, method?: string) =>
    projectApi(projectId, path, body, method);
  async function load() {
    if (!user || user.demo) return;
    if (routes[kind]) setData(await request(routes[kind]));
  }
  async function run(fn: () => Promise<any>, refresh = true) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (refresh) await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operasi gagal.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    setValue("");
    setError("");
    setNotice("");
    setBusy(true);
    let alive = true;
    api("/status")
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => {
        if (alive) setError("Server tidak merespons.");
      });
    load()
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [kind, projectId, user?.id]);
  const btn = (label: string, fn: () => Promise<any>, enabled = true) => (
    <button
      className="primary"
      disabled={busy || !cloud || !enabled}
      onClick={() => void run(fn)}
    >
      {label}
    </button>
  );
  return (
    <section className="service-panel" aria-busy={busy}>
      {!cloud && (
        <div className="service-notice">
          Layanan cloud belum tersedia untuk sesi ini. Masuk dengan akun
          Supabase dan konfigurasi environment server. Tidak ada email,
          pembayaran, atau audit yang disimulasikan.
        </div>
      )}
      {!webRuntime && ["packages", "security"].includes(kind) && (
        <p className="service-notice" role="status">
          Runtime Vite, instalasi npm sandbox dan Lighthouse ini khusus Web App.{" "}
          {projectKind === "roblox"
            ? "Gunakan Roblox Studio untuk menjalankan dan mempublikasikan game."
            : "Gunakan Expo untuk menjalankan atau membangun aplikasi native."}{" "}
          Source tidak dikonversi menjadi web.
        </p>
      )}
      {busy && <p role="status">Memproses permintaan…</p>}
      {error && (
        <div className="service-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="service-notice" role="status">
          {notice}
        </div>
      )}
      {kind === "invite" && (
        <>
          <p>
            Tautan sekali pakai berlaku 7 hari. Email opsional; tanpa email,
            siapa pun dengan tautan dapat menerima undangan setelah masuk.
          </p>
          <label>
            Email penerima
            <input
              type="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="rekan@perusahaan.com"
            />
          </label>
          <label>
            Peran
            <select value={option} onChange={(e) => setOption(e.target.value)}>
              <option>Viewer</option>
              <option>Editor</option>
            </select>
          </label>
          {btn(
            "Buat undangan",
            async () => {
              const d = await request("invites", {
                email: value,
                role: option,
              });
              setNotice(
                (d.emailSent
                  ? "Email terkirim. "
                  : d.notice || "Bagikan tautan ini secara privat. ") +
                  " " +
                  d.link,
              );
            },
            owner,
          )}
          {data?.members?.map((m: any) => (
            <div className="service-row" key={m.id}>
              <div>
                {m.name}
                <small>{m.role}</small>
              </div>
              {owner && m.role !== "Owner" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      request("members/" + m.id, { role: "remove" }, "PATCH"),
                    )
                  }
                >
                  Hapus akses
                </button>
              )}
            </div>
          ))}
          {data?.invites
            ?.filter((i: any) => !i.revoked_at && !i.accepted_at)
            .map((i: any) => (
              <div className="service-row" key={i.id}>
                <div>
                  {i.email || "Undangan dengan tautan"}
                  <small>
                    {i.role} ·{" "}
                    {new Date(i.expires_at).toLocaleDateString("id-ID")}
                  </small>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      request("invites/" + i.id, undefined, "DELETE"),
                    )
                  }
                >
                  Cabut
                </button>
              </div>
            ))}
        </>
      )}
      {kind === "packages" && (
        <>
          <h3>Dependensi project</h3>
          {Object.entries(installed).map(([name, version]) => (
            <div className="service-row" key={name}>
              <span>
                {name}
                <small>{version}</small>
              </span>
              <button
                disabled={
                  busy ||
                  !editor ||
                  !status?.capabilities?.sandbox ||
                  !webRuntime
                }
                onClick={() =>
                  void run(async () => {
                    const d = await request("packages", {
                      spec: name,
                      remove: true,
                    });
                    if (d.exitCode !== 0) throw new Error(d.output);
                    useStore
                      .getState()
                      .applyFiles(projectId, d.files, "Hapus paket " + name);
                    setNotice("Dependensi diperbarui.");
                  }, false)
                }
              >
                Hapus
              </button>
            </div>
          ))}
          <p>
            Cari paket resmi dari registry npm. Install berjalan di E2B, bukan
            mesin server PiwuApp. Perubahan package.json disimpan sebagai versi
            yang dapat dipulihkan.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                async () =>
                  setData(
                    await api("/packages?q=" + encodeURIComponent(value)),
                  ),
                false,
              );
            }}
          >
            <label>
              Nama paket
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="lucide-react"
              />
            </label>
            <button disabled={busy || !cloud}>Cari registry</button>
          </form>
          {data?.packages?.map((p: any) => (
            <div className="service-row" key={p.name}>
              <div>
                <b>
                  {p.name} <small>{p.version}</small>
                </b>
                <p>{p.description}</p>
              </div>
              <button
                disabled={
                  busy ||
                  !editor ||
                  !status?.capabilities?.sandbox ||
                  !webRuntime
                }
                onClick={() =>
                  void run(async () => {
                    const result = await request("packages", {
                      spec: p.name + "@" + p.version,
                    });
                    if (result.exitCode !== 0) throw new Error(result.output);
                    useStore
                      .getState()
                      .applyFiles(projectId, result.files, "Install " + p.name);
                    setNotice(result.output);
                  }, false)
                }
              >
                Install · 2 kredit
              </button>
            </div>
          ))}
          <div className="service-actions">
            {btn(
              "Jalankan preview sandbox",
              async () => {
                const d = await request("sandbox/preview", {});
                if (!d.url) throw new Error(d.output);
                setData((v: any) => ({ ...v, previewUrl: d.url }));
                setNotice(d.notice);
              },
              editor && webRuntime && status?.capabilities?.sandbox,
            )}
            {btn(
              "Impor perubahan sandbox",
              async () => {
                const d = await request("sandbox/files");
                if (
                  !confirm(
                    "Ganti kode workspace dengan snapshot sandbox? Versi saat ini tetap dapat dipulihkan.",
                  )
                )
                  return;
                const store = useStore.getState(),
                  p = store.projects.find((p) => p.id === projectId);
                if (!p) return;
                store.applyFiles(projectId, d.files, "Impor perubahan shell");
                store.updateProject(projectId, { files: d.files });
                setNotice(d.notice);
              },
              editor && webRuntime && status?.capabilities?.sandbox,
            )}
            {btn(
              "Hentikan sandbox",
              async () => {
                await request("sandbox", undefined, "DELETE");
                setData((v: any) => ({ ...v, previewUrl: null }));
              },
              editor,
            )}
          </div>
          {data?.previewUrl && (
            <a href={data.previewUrl} target="_blank" rel="noreferrer">
              Buka preview sandbox sementara ↗
            </a>
          )}
        </>
      )}
      {kind === "security" && (
        <>
          <p>
            Lighthouse asli dijalankan di sandbox terisolasi pada hasil build.
            Skor bukan estimasi statis. Audit memerlukan template E2B dengan
            Chromium dan Lighthouse.
          </p>
          {btn(
            "Jalankan Lighthouse · 3 kredit",
            async () => {
              await request("audit", {});
            },
            // `capabilities.audit` needs a database, an E2B key AND an E2B
            // template with Chromium + Lighthouse, which is what the route uses.
            editor && webRuntime && status?.capabilities?.audit,
          )}
          {data?.reports?.map((r: any) => (
            <div key={r.id}>
              <small>{new Date(r.created_at).toLocaleString("id-ID")}</small>
              <div className="service-grid">
                {Object.entries(r.findings?.scores || {}).map(([k, v]) => (
                  <div className="service-card" key={k}>
                    <strong className="metric">{String(v ?? "—")}</strong>
                    <p>{k}</p>
                  </div>
                ))}
              </div>
              {r.findings?.findings?.slice(0, 15).map((f: any) => (
                <div className="service-row" key={f.id}>
                  {f.title}
                </div>
              ))}
            </div>
          ))}
          {!data?.reports?.length && (
            <p>
              Belum ada hasil Lighthouse. Pemeriksaan statis lokal tersedia di
              panel keamanan.
            </p>
          )}
        </>
      )}
      {kind === "secrets" && (
        <>
          <p>
            Nilai dienkripsi AES-256-GCM di server, tidak pernah dikirim kembali
            ke browser atau dimasukkan ke preview statis. Penggunaan runtime
            memerlukan backend aplikasi terpisah.
          </p>
          <label>
            Nama secret
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              placeholder="PAYMENT_API_KEY"
              autoComplete="off"
            />
          </label>
          <label>
            Nilai
            <input
              type="password"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            Environment
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              <option value="dev">Development</option>
              <option value="production">Production</option>
            </select>
          </label>
          {btn(
            "Enkripsi & simpan",
            async () => {
              await request("secrets", {
                key: value,
                value: secretValue,
                environment,
              });
              setSecretValue("");
              setNotice(
                "Secret tersimpan terenkripsi. Nilainya tidak dapat dibaca kembali.",
              );
            },
            owner && status?.capabilities?.secrets,
          )}
          {data?.secrets?.map((s: any) => (
            <div className="service-row" key={s.id}>
              <span>
                {s.key}
                <small>{s.environment}</small>
              </span>
              <button
                disabled={busy || !owner}
                onClick={() =>
                  void run(() =>
                    request("secrets/" + s.id, undefined, "DELETE"),
                  )
                }
              >
                Hapus
              </button>
            </div>
          ))}
        </>
      )}
      {kind === "assets" && (
        <>
          <p>
            Storage privat. Tautan unduhan bertanda tangan berlaku 5 menit;
            jangan membagikannya ke publik.
          </p>
          <label>
            Unggah aset (maks. 4 MB)
            <input
              disabled={busy || !cloud || !editor}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async () => {
                    await request("assets", await readAttachment(file));
                  });
                e.target.value = "";
              }}
            />
          </label>
          {data?.assets?.map((a: any) => (
            <div className="service-row" key={a.id}>
              <div>
                <a href={a.url || undefined} target="_blank" rel="noreferrer">
                  {a.path.split("/").at(-1)}
                </a>
                <small>
                  {Math.round(a.size_bytes / 1024)} KB · {a.mime}
                </small>
              </div>
              <button
                disabled={busy || !editor}
                onClick={() =>
                  void run(() => request("assets/" + a.id, undefined, "DELETE"))
                }
              >
                Hapus
              </button>
            </div>
          ))}
          {!data?.assets?.length && <p>Belum ada aset cloud.</p>}
        </>
      )}
      {kind === "comments" && (
        <>
          <label>
            Konteks elemen
            <input
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              placeholder=".hero atau src/App.tsx"
            />
          </label>
          <label>
            Komentar
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={4000}
            />
          </label>
          {btn("Kirim komentar", async () => {
            await request("comments", { body: value, selector: secondary });
            setValue("");
          })}
          {data?.comments?.map((c: any) => (
            <div className="service-row" key={c.id}>
              <div>
                <small>
                  {c.element_selector} · {c.status}
                </small>
                <p>{c.body}</p>
              </div>
              <button
                disabled={busy || (!editor && c.author_id !== user?.id)}
                onClick={() =>
                  void run(() =>
                    request(
                      "comments/" + c.id,
                      { status: c.status === "open" ? "resolved" : "open" },
                      "PATCH",
                    ),
                  )
                }
              >
                {c.status === "open" ? "Selesai" : "Buka lagi"}
              </button>
            </div>
          ))}
        </>
      )}
      {kind === "reference" && (
        <>
          <p>
            Ambil struktur, teks, dan warna dari URL HTTPS publik, lalu bangun
            interpretasi orisinal. Bukan salinan pixel-perfect atau penyalinan
            aset/logo. Halaman yang memerlukan login tidak didukung.
          </p>
          <label>
            URL inspirasi
            <input
              type="url"
              placeholder="https://contoh.id"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {btn(
            "Analisis referensi",
            async () => {
              const d = await request("reference", { url: value });
              setData(d);
            },
            editor,
          )}
          {data?.reference && (
            <>
              <h3>{data.reference.title}</h3>
              <p>{data.reference.headings.join(" · ")}</p>
              <pre>{data.reference.text.slice(0, 1500)}</pre>
              <button
                onClick={() =>
                  onReference?.(data.reference.url, data.reference.title)
                }
              >
                Gunakan sebagai konteks AI
              </button>
            </>
          )}
        </>
      )}
      {kind === "marketplace" && (
        <>
          <p>
            Publikasikan salinan kode tanpa chat, komentar, atau secrets.
            Platform mencatat bagi hasil 80% untuk kreator. Pencairan dana
            memerlukan peninjauan manual; belum ada payout otomatis.
          </p>
          <label>
            Judul
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={80}
            />
          </label>
          <label>
            Deskripsi
            <textarea
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            Harga IDR (0 = gratis)
            <input
              type="number"
              min="0"
              max="10000000"
              value={option === "Viewer" ? "0" : option}
              onChange={(e) => setOption(e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Saya memiliki hak distribusi seluruh kode/aset dan sudah menghapus
            data pribadi.
          </label>
          {btn(
            "Terbitkan template",
            async () => {
              await request("template", {
                title: value,
                description: secondary,
                price: Number(option === "Viewer" ? 0 : option),
                category: "Website",
                confirmRights: true,
              });
              setNotice("Template dipublikasikan di marketplace.");
            },
            owner && confirmed,
          )}
          <Link to="/marketplace">Buka marketplace ↗</Link>
        </>
      )}
      {kind === "integrations" && (
        <>
          <p>
            Status berikut menunjukkan konfigurasi server, bukan verifikasi
            koneksi langsung. Kredensial hanya diisi melalui environment
            deployment.
          </p>
          {btn("Periksa koneksi Supabase & AI", async () => {
            const d = await api("/verify", {});
            const labels: Record<string, string> = {
              verified: "terverifikasi",
              failed: "gagal",
              not_configured: "belum dikonfigurasi",
              model_available: "model tersedia",
              endpoint_reachable: "endpoint merespons; model perlu diuji",
              inconclusive: "belum terkonfirmasi",
              unreachable: "tidak dapat dijangkau",
            };
            setNotice(
              `Auth: ${labels[d.auth]}. Database: ${labels[d.database]}. AI: ${labels[d.ai]}. ${d.notice}`,
            );
          })}
          {Object.entries(status?.capabilities || {}).map(([k, v]) => (
            <div className="service-row" key={k}>
              <b>
                {(
                  {
                    auth: "Autentikasi",
                    cloud: "Database cloud",
                    ai: "Provider AI",
                    search: "Riset & pencarian",
                    whatsapp: "OTP WhatsApp",
                    sandbox: "Sandbox",
                    payments: "Pembayaran",
                    email: "Email undangan",
                    secrets: "Enkripsi secrets",
                    audit: "Lighthouse",
                    marketplace: "Marketplace",
                    recordings: "Rekaman berbagi",
                  } as Record<string, string>
                )[k] || k}
              </b>
              <small>
                {v
                  ? "Dikonfigurasi · belum diverifikasi"
                  : "Belum dikonfigurasi"}
              </small>
            </div>
          ))}
          <p>
            Panduan administrator: docs/SERVICES_SETUP.md. Jangan tempel API key
            ke chat atau file project.
          </p>
        </>
      )}
      {kind === "credits" && (
        <>
          <p>
            Kredit AI, sandbox, dan audit dihitung server-side. Lihat saldo,
            transaksi, dan referral di halaman akun.
          </p>
          <Link className="button button-dark" to="/account">
            Buka akun & penagihan
          </Link>
        </>
      )}
    </section>
  );
}
