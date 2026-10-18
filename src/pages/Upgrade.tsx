import { useEffect, useState } from "react";
import { mergePlans } from "../../shared/credits.mjs";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "../components/ui";
import { api } from "../services/api";
import { useStore } from "../lib/store";
import {
  PLAN_DAYS,
  count,
  costLine,
  expiryLine,
  lastsLabel,
  offerExpiry,
  planBenefits,
  planFacts,
  planOffers,
  periodLeft,
  paymentsNotice,
  rupiah,
  topupOffers,
  usageProfile,
  usageRows,
  type Offer,
} from "../lib/dashboard/plans";
import "../components/services/services.css";
import "../components/services/upgrade.css";

/**
 * The upgrade page. Everything it shows about prices and credit comes from
 * `GET /api/account` (the same products the server sells), so a product change
 * on the server shows up here without a code change. When payments are off, the
 * page says so and disables checkout instead of offering a button that fails.
 */
export default function Upgrade() {
  const user = useStore((s) => s.user);
  const signedIn = Boolean(user && !user.demo);
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState("");

  const load = async () => {
    const account = await api("/account");
    setData(account);
  };

  useEffect(() => {
    let alive = true;
    setError("");
    if (!signedIn) return;
    setBusy(true);
    load()
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Gagal dimuat.");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [user?.id, signedIn]);

  const checkout = async (sku: string) => {
    setPending(sku);
    setError("");
    try {
      const d = await api("/checkout", { sku });
      if (!d.url?.startsWith("https://"))
        throw new Error(
          "Provider tidak mengembalikan tautan pembayaran yang aman.",
        );
      location.assign(d.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout gagal dimulai.");
      setPending("");
    }
  };

  const rowText = (offer: Offer, id: string) =>
    offer.durations.find((entry) => entry.id === id)?.text || "—";
  const light = (offer: Offer) => rowText(offer, "ringan");
  const normal = (offer: Offer) => rowText(offer, "normal");
  const intens = (offer: Offer) => rowText(offer, "intens");

  const currentPlan = data?.plan?.plan || "Free";
  const plans = planOffers(data?.products, currentPlan);
  const topups = topupOffers(data?.products);
  // The benefit list follows the products the server actually sells, which
  // include any price/credit change saved in the admin panel.
  const benefits = planBenefits(
    mergePlans(
      Object.fromEntries(
        plans.map((offer) => [
          offer.plan.toLowerCase(),
          { amount: offer.price, credits: offer.credits },
        ]),
      ),
    ),
  );
  const notice = paymentsNotice(data?.paymentsEnabled, data?.provider);
  const left = periodLeft(data?.plan?.current_period_end);
  const balance = Number(data?.balance);
  const balanceKnown = Number.isFinite(balance);
  const usage = usageRows();

  const card = (offer: Offer, kind: "plan" | "topup") => (
    <div
      className={"plan-card" + (offer.current ? " plan-card-current" : "")}
      key={offer.sku}
    >
      {offer.current && <span className="plan-flag">Paket Anda sekarang</span>}
      <h3>{offer.plan || offer.label}</h3>
      {offer.plan && offer.label !== offer.plan && (
        <small className="plan-sub">{offer.label}</small>
      )}
      <strong className="plan-price">
        {rupiah(offer.price)}
        <small className="plan-rate"> · {rupiah(offer.rate)}/kredit</small>
      </strong>
      <p className="plan-credits">
        <b>{count(offer.credits)}</b>
        {kind === "plan" ? " kredit per bulan" : " kredit"}
        {kind === "plan"
          ? ` · masa paket ${PLAN_DAYS} hari · ${count(offer.daily)} kredit/hari`
          : " · tanpa masa aktif"}
      </p>
      <p className="plan-meta">
        {kind === "plan"
          ? `Pada pemakaian normal jatah ini bertahan ${normal(offer)}, pada pemakaian intens ${intens(offer)}.`
          : `Menambah ${light(offer)} pemakaian ringan atau ${normal(offer)} pemakaian normal ke saldo berjalan; pada pola intens jatah ini ${intens(offer)}.`}{" "}
        {offerExpiry(offer)}
      </p>
      {kind === "plan" && (
        <ul className="plan-benefits">
          {(
            benefits.find((entry) => entry.plan === offer.plan)?.items || []
          ).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <button
        className="button button-dark"
        disabled={!notice.ready || busy || Boolean(pending)}
        aria-label={
          (kind === "plan" ? "Berlangganan " : "Beli top-up ") + offer.label
        }
        onClick={() => void checkout(offer.sku)}
      >
        {pending === offer.sku
          ? "Membuka checkout…"
          : kind === "plan" && offer.current
            ? "Perpanjang paket"
            : "Checkout"}
      </button>
    </div>
  );

  return (
    <main className="service-page upgrade-page">
      <header>
        <Logo />
        <nav>
          <Link to="/projects">Project</Link>
          <Link to="/account">Akun &amp; kredit</Link>
          <Link to="/marketplace">Marketplace</Link>
        </nav>
      </header>
      <span className="eyebrow-label">PIWUAPP / PAKET</span>
      <h1>Naikkan paket saat karya menuntut lebih.</h1>
      <p className="upgrade-lead">
        Semua paket di halaman ini prabayar {PLAN_DAYS} hari. Tidak ada
        penagihan berulang dan tidak ada penguncian fitur yang disembunyikan.{" "}
        {expiryLine(data?.credits)}
      </p>
      <p className="upgrade-final">
        Pembelian paket dan top-up bersifat final; PiwuApp tidak menyediakan
        refund.
      </p>

      {!signedIn && (
        <section className="service-panel">
          <div className="service-error" role="alert">
            Halaman paket membutuhkan sesi terverifikasi. Masuk lebih dulu agar
            pembelian dan kredit tercatat pada akun Anda — bukan pada peramban
            ini.
            <div className="service-actions">
              <Link to={"/login?next=" + encodeURIComponent("/upgrade")}>
                Masuk ke akun cloud
              </Link>
            </div>
          </div>
        </section>
      )}

      {signedIn && (
        <section className="service-panel" aria-busy={busy}>
          {busy && <p role="status">Memuat paket…</p>}
          {error && (
            <div className="service-error" role="alert">
              {error}
              <div className="service-actions">
                <button
                  onClick={() => {
                    setBusy(true);
                    void load()
                      .catch((e) =>
                        setError(
                          e instanceof Error ? e.message : "Gagal dimuat.",
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Coba lagi
                </button>
                <Link to="/account">Buka Akun &amp; kredit</Link>
              </div>
            </div>
          )}

          <div className="plan-status">
            <div>
              <span>Paket aktif</span>
              <strong>{data ? currentPlan : "…"}</strong>
              <small>
                {left ||
                  (data
                    ? "Tanpa masa aktif berbayar"
                    : "Menunggu jawaban server")}
              </small>
            </div>
            <div>
              <span>Kredit tersedia</span>
              <strong>{data ? count(data.balance) : "…"}</strong>
              <small>
                {balanceKnown
                  ? `${lastsLabel(balance, usageProfile("normal"))} pada pemakaian normal`
                  : "Terpakai per operasi, tercatat di ledger"}
              </small>
            </div>
            <div className="plan-status-actions">
              <Link to="/account">Riwayat &amp; pesanan</Link>
              <Link to="/projects">Kembali ke dashboard</Link>
            </div>
          </div>

          {!data && !busy && !error && (
            <p className="plan-meta">
              Paket belum bisa dimuat, jadi daftar harga tidak ditampilkan.
              Harga yang tidak terbaca tidak diganti dengan angka perkiraan.
            </p>
          )}

          {data && (
            <>
              <p
                className={
                  "plan-notice" + (notice.ready ? "" : " plan-notice-warn")
                }
              >
                {notice.text}
              </p>

              <h2>Paket</h2>
              {plans.length ? (
                <div className="plan-grid">
                  {plans.map((offer) => card(offer, "plan"))}
                </div>
              ) : (
                <p className="plan-meta">
                  Server tidak melaporkan satu pun produk paket. Tidak ada
                  penawaran yang ditampilkan karena tidak ada yang bisa dibeli.
                </p>
              )}

              <h2>Top-up kredit</h2>
              {topups.length ? (
                <div className="plan-grid">
                  {topups.map((offer) => card(offer, "topup"))}
                </div>
              ) : (
                <p className="plan-meta">
                  Server tidak melaporkan produk top-up. Kredit dapat ditambah
                  lewat paket di atas bila tersedia.
                </p>
              )}

              <h2>Seberapa lama kredit bertahan</h2>
              <p className="plan-meta">
                {expiryLine(data?.credits)} Tabel ini menjawab pertanyaan yang
                berbeda — berapa lama sebuah jatah terpakai habis pada tiga pola
                pemakaian. Angkanya aritmetika dari harga per operasi (
                {costLine()}), bukan janji; pemakaian Anda bisa lebih hemat atau
                lebih boros.
              </p>
              <div
                className="plan-table"
                role="table"
                aria-label="Perkiraan durasi kredit per pola pemakaian"
              >
                <div className="plan-table-row plan-table-head" role="row">
                  <span role="columnheader">Pola pemakaian</span>
                  <span role="columnheader">Kredit/hari</span>
                  {balanceKnown && <span role="columnheader">Saldo Anda</span>}
                  {plans.map((offer) => (
                    <span role="columnheader" key={offer.sku}>
                      {offer.plan}
                    </span>
                  ))}
                </div>
                {usage.map((row, index) => (
                  <div className="plan-table-row" role="row" key={row.id}>
                    <span role="cell">
                      <b>{row.label}</b>
                      <small>{row.detail}</small>
                    </span>
                    <span role="cell">{row.perDay}</span>
                    {balanceKnown && (
                      <span role="cell">
                        {lastsLabel(balance, usageProfile(row.id))}
                      </span>
                    )}
                    {plans.map((offer) => (
                      <span role="cell" key={offer.sku}>
                        {offer.durations[index]?.text || "—"}
                      </span>
                    ))}
                  </div>
                ))}
              </div>

              {!!data.orders?.length && (
                <>
                  <h2>Pesanan terakhir</h2>
                  {data.orders.slice(0, 5).map((o: any) => (
                    <div className="service-row" key={o.id}>
                      <span>
                        {o.sku} · {rupiah(o.amount)}
                        <small>
                          {o.status} ·{" "}
                          {new Date(o.created_at).toLocaleString("id-ID")}
                        </small>
                      </span>
                      {o.checkout_url &&
                        ["pending", "created"].includes(o.status) && (
                          <a href={o.checkout_url}>Lanjutkan pembayaran ↗</a>
                        )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </section>
      )}

      <section className="service-panel">
        <h2>Yang berlaku hari ini</h2>
        <div className="plan-facts">
          {planFacts().map((fact) => (
            <div className="plan-fact" key={fact.title}>
              <b>{fact.title}</b>
              <p>{fact.detail}</p>
            </div>
          ))}
        </div>
        <p className="plan-meta">
          Butuh faktur atau pembayaran nominal lain? Halaman ini hanya memakai
          produk yang dilaporkan server; tidak ada SKU tersembunyi.
        </p>
        <div className="service-actions">
          <button
            onClick={() =>
              navigate(signedIn ? "/projects" : "/login?next=/upgrade")
            }
          >
            {signedIn ? "Kembali ke dashboard" : "Masuk untuk membeli"}
          </button>
        </div>
      </section>
    </main>
  );
}
