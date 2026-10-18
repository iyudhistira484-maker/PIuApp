import { useEffect, useState, lazy, Suspense } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Logo } from "../components/ui";
import { api } from "../services/api";
import { useStore } from "../lib/store";
import { requestCloudSync } from "../lib/cloud/sync";
import {
  capLine,
  count,
  creditsNote,
  dailyLine,
  lastsLabel,
  serverDailyLine,
  usageProfile,
  type ServerCredits,
} from "../lib/dashboard/plans";
const ReplayPlayer = lazy(() => import("../components/services/ReplayPlayer"));
import "../components/services/services.css";
const money = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
export default function Services({
  page,
}: {
  page: "account" | "marketplace" | "invite" | "recording";
}) {
  const { token } = useParams(),
    user = useStore((s) => s.user),
    navigate = useNavigate();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState("");
  const load = () =>
    api(
      page === "account"
        ? "/account"
        : page === "marketplace"
          ? "/marketplace"
          : page === "invite"
            ? "/invites/" + token
            : "/public/recordings/" + token,
    ).then(setData);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operasi gagal.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setData(null);
    setNotice("");
    void run(async () => {
      await load();
    });
  }, [page, token, user?.id]);
  const checkout = async (sku: string, templateId?: string) => {
    const d = await api("/checkout", { sku, templateId });
    if (!d.url?.startsWith("https://"))
      throw new Error("Tautan checkout tidak valid.");
    location.assign(d.url);
  };
  return (
    <main className="service-page">
      <header>
        <Logo />
        <nav>
          <Link to="/projects">Project</Link>
          <Link to="/marketplace">Marketplace</Link>
          <Link to="/account">Akun & kredit</Link>
        </nav>
      </header>
      <span className="eyebrow-label">
        PIWUAPP /{" "}
        {page === "account"
          ? "AKUN"
          : page === "marketplace"
            ? "MARKETPLACE"
            : page === "invite"
              ? "KOLABORASI"
              : "REPLAY"}
      </span>
      <h1>
        {
          {
            account: "Ruang untuk bertumbuh.",
            marketplace: "Mulai dari karya yang baik.",
            invite: "Bangun bersama.",
            recording: "Lihat sebuah ide menjadi nyata.",
          }[page]
        }
      </h1>
      <section className="service-panel" aria-busy={busy}>
        {busy && <p role="status">Memuat layanan…</p>}
        {error && (
          <div className="service-error" role="alert">
            {error}
            <div className="service-actions">
              <button
                onClick={() =>
                  void run(async () => {
                    await load();
                  })
                }
              >
                Coba lagi
              </button>
              {(!user || user.demo) && (
                <Link
                  to={"/login?next=" + encodeURIComponent(location.pathname)}
                >
                  Masuk ke akun cloud
                </Link>
              )}
            </div>
          </div>
        )}
        {notice && <div className="service-notice">{notice}</div>}
        {page === "account" && data && (
          <>
            <div className="service-grid">
              <div className="service-card">
                <strong className="metric">{count(data.balance)}</strong>
                <p>Kredit tersedia</p>
                <small>
                  {lastsLabel(data.balance, usageProfile("normal"))} pada
                  pemakaian normal · jatah harian direset, kredit paket &amp;
                  top-up ada masa berlaku
                </small>
              </div>
              <div className="service-card">
                <strong className="metric">{data.plan.plan}</strong>
                <p>
                  {data.plan.current_period_end
                    ? "Aktif hingga " +
                      new Date(data.plan.current_period_end).toLocaleDateString(
                        "id-ID",
                      )
                    : "Paket gratis"}
                </p>
                <small
                  className="credit-daily"
                  data-credits={data.credits?.source || ""}
                >
                  {data.credits
                    ? data.credits.applied
                      ? serverDailyLine(data.credits)
                      : creditsNote(data.credits)
                    : dailyLine(data.plan.plan)}
                </small>
                {!!capLine(data.credits as ServerCredits | null) && (
                  <small className="credit-cap">
                    {capLine(data.credits as ServerCredits | null)}
                  </small>
                )}
              </div>
            </div>
            <h2>Paket & top-up</h2>
            <p className="service-actions">
              <Link to="/upgrade">
                Buka halaman paket (perbandingan & rincian kredit)
              </Link>
            </p>
            <p>
              Paket prabayar 30 hari, tanpa penagihan otomatis. Pembelian paket
              tambahan dijadwalkan setelah masa aktif sebelumnya; kredit
              ditambahkan langsung. Metode pembayaran yang tersedia ditampilkan
              oleh provider pada checkout. Harga dalam IDR.{" "}
              <b>Semua pembelian bersifat final dan tidak dapat direfund</b>,
              termasuk paket, top-up, dan template.
            </p>
            <div className="service-grid">
              {Object.entries(data.products).map(([sku, p]: [string, any]) => (
                <div className="service-card" key={sku}>
                  <h3>{p.label}</h3>
                  <p>
                    {money(p.amount)} · {count(p.credits)} kredit
                  </p>
                  <button
                    disabled={busy || !data.paymentsEnabled}
                    onClick={() => void run(() => checkout(sku))}
                  >
                    Lanjut ke checkout
                  </button>
                </div>
              ))}
            </div>
            {!data.paymentsEnabled && (
              <p>Pembayaran belum dikonfigurasi. Tidak ada tagihan dibuat.</p>
            )}
            <h2>Referral</h2>
            <p>
              Kode Anda: <b>{data.referral.code}</b> · {data.referral.rewarded}{" "}
              referral mendapatkan bonus.
            </p>
            <p>
              50 kredit untuk masing-masing akun setelah pembelian paket/top-up
              minimal Rp49.000 terverifikasi. Bonus dibatalkan bila penyedia
              membatalkan atau menarik pembayaran.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const d = await api("/referrals/claim", { code });
                  setNotice(d.notice);
                  await load();
                });
              }}
            >
              <label>
                Klaim kode referral (akun baru ≤7 hari)
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={32}
                />
              </label>
              <button disabled={busy || !code}>Klaim referral</button>
            </form>
            <h2>Pesanan</h2>
            {!data.orders.length && <p>Belum ada pesanan.</p>}
            {data.orders.map((o: any) => (
              <div className="service-row" key={o.id}>
                <div>
                  {o.sku} · {money(o.amount)}
                  <small>
                    {o.status} ·{" "}
                    {new Date(o.created_at).toLocaleString("id-ID")}
                  </small>
                </div>
                <div className="service-actions">
                  {o.checkout_url &&
                    ["pending", "created"].includes(o.status) && (
                      <a href={o.checkout_url}>Checkout ↗</a>
                    )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api("/orders/" + o.id + "/refresh", {});
                        await load();
                      })
                    }
                  >
                    Cek status
                  </button>
                </div>
              </div>
            ))}
            <h2>Riwayat kredit</h2>
            {data.ledger.map((r: any) => (
              <div className="service-row" key={r.id}>
                <span>
                  {r.reason}
                  <small>
                    {new Date(r.created_at).toLocaleString("id-ID")}
                  </small>
                </span>
                <b>
                  {r.delta > 0 ? "+" : ""}
                  {r.delta}
                </b>
              </div>
            ))}
            <h2>Pendapatan template</h2>
            <p>
              {money(
                data.sales
                  .filter((s: any) => s.status === "accrued")
                  .reduce((n: number, s: any) => n + s.net, 0),
              )}{" "}
              tercatat dari maksimal 100 penjualan terbaru. Bukan saldo siap
              cair; payout/KYC belum otomatis.
            </p>
          </>
        )}
        {page === "marketplace" && data && (
          <>
            <div className="service-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await load();
                  })
                }
              >
                Jelajahi
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setData(await api("/marketplace/purchased"));
                  })
                }
              >
                Template yang dibeli
              </button>
            </div>
            <p>
              Template komunitas dengan kode yang dapat Anda lanjutkan. Tinjau
              kode dan lisensi sebelum digunakan dalam produksi. Pembelian
              template bersifat final; tidak ada refund. Laporan masalah di
              halaman profil hanya mencatat keluhan dan balasan penjual.
            </p>
            {!data.templates.length && (
              <p>
                Belum ada template komunitas. Publikasikan milik Anda dari
                Layanan → Jual template di workspace.
              </p>
            )}
            <div className="service-grid">
              {data.templates.map((t: any) => (
                <article className="service-card" key={t.id}>
                  <small>{t.category}</small>
                  <h3>{t.title}</h3>
                  <p>{t.description}</p>
                  <p>
                    <b>{t.price ? money(t.price) : "Gratis"}</b>
                  </p>
                  {t.preview_url && (
                    <a href={t.preview_url} target="_blank" rel="noreferrer">
                      Lihat website ↗
                    </a>
                  )}
                  <div className="service-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { snapshot } = await api(
                            "/marketplace/" + t.id + "/use",
                            {},
                          );
                          const id = useStore
                            .getState()
                            .createProject(snapshot.name);
                          useStore
                            .getState()
                            .applyFiles(
                              id,
                              snapshot.files,
                              "Impor template marketplace",
                            );
                          useStore.getState().updateProject(id, {
                            files: snapshot.files,
                            name: snapshot.name,
                            description: snapshot.description,
                            template: snapshot.template,
                          });
                          navigate("/project/" + id);
                        })
                      }
                    >
                      Gunakan
                    </button>
                    {t.price > 0 && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() => checkout("template", t.id))
                        }
                      >
                        Beli template
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {page === "invite" && data && (
          <>
            <h2>{data.name}</h2>
            <p>
              Anda diundang sebagai <b>{data.role}</b>. Viewer membaca dan
              berkomentar; Editor dapat mengubah kode dan menjalankan AI dengan
              kreditnya sendiri.
            </p>
            <p>
              Berlaku hingga {new Date(data.expiresAt).toLocaleString("id-ID")}.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const d = await api("/invites/" + token + "/accept", {});
                  requestCloudSync();
                  setNotice(
                    "Undangan diterima. Project akan tersedia setelah sinkronisasi cloud.",
                  );
                  navigate("/projects");
                })
              }
            >
              Terima undangan
            </button>
          </>
        )}
        {page === "recording" && data && (
          <>
            <h2>{data.recording.title}</h2>
            <Suspense fallback={<p>Memuat pemutar…</p>}>
              <ReplayPlayer events={data.recording.events} />
            </Suspense>
          </>
        )}
      </section>
    </main>
  );
}
