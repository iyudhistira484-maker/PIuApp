import { useEffect, useState } from "react";
import { Banknote, ShieldCheck, Wallet } from "lucide-react";
import { api } from "../../services/api";
import "./services.css";

const money = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const KYC_LABEL: Record<string, string> = {
  unverified: "Belum diajukan",
  pending: "Menunggu tinjauan",
  verified: "Terverifikasi",
  rejected: "Ditolak",
};
const PAYOUT_LABEL: Record<string, string> = {
  requested: "Diminta",
  approved: "Disetujui",
  paid: "Dibayar",
  rejected: "Ditolak",
};

/**
 * Seller earnings and reviewed payouts. PiwuApp does not move money: a
 * superadmin transfers it out-of-band and records the reference here.
 */
export default function PayoutSection() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [kyc, setKyc] = useState({
    legal_name: "",
    business_name: "",
    tax_id: "",
    country: "ID",
  });
  const [request, setRequest] = useState({
    amount: "",
    method: "bank",
    destination: "",
  });

  const load = () =>
    api("/marketplace/payouts")
      .then((d) => {
        setData(d);
        setError("");
        if (d.verification?.legal_name)
          setKyc((old) => ({
            ...old,
            legal_name: d.verification.legal_name || old.legal_name,
            business_name: d.verification.business_name || "",
            tax_id: d.verification.tax_id || "",
            country: d.verification.country || "ID",
          }));
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Payout gagal dimuat."),
      );

  useEffect(() => {
    void load();
  }, []);

  const submitKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ status: string }>("/marketplace/kyc", kyc);
      setNotice(
        result.status === "verified"
          ? "Verifikasi sudah aktif."
          : "Data KYC terkirim. Menunggu tinjauan superadmin.",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "KYC gagal dikirim.");
    } finally {
      setBusy(false);
    }
  };

  const submitPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const amount = Number(request.amount.replace(/[^\d]/g, ""));
      await api("/marketplace/payouts", {
        amount,
        method: request.method,
        destination: request.destination,
      });
      setRequest({ amount: "", method: "bank", destination: "" });
      setNotice(
        "Permintaan payout tercatat. Dana dikirim setelah disetujui superadmin.",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payout gagal diminta.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <section className="payout-section" aria-label="Pendapatan marketplace">
        <div className="payout-heading">
          <div>
            <h2>Pendapatan marketplace</h2>
            <p>
              Saldo, verifikasi penjual, dan permintaan payout dimuat dari
              server.
            </p>
          </div>
          <Wallet size={20} />
        </div>
        {error ? (
          <p className="payout-error">
            {error} Saldo tidak ditampilkan daripada menebak angkanya.
          </p>
        ) : (
          <p className="payout-loading">Memuat payout…</p>
        )}
      </section>
    );
  }
  const balance = data.balance || {
    accrued: 0,
    pending: 0,
    paid: 0,
    available: 0,
    frozen: 0,
  };
  const status = data?.verification?.status || "unverified";
  const verified = status === "verified";
  const canRequest = verified && balance.available >= 50000;

  return (
    <section className="payout-section" aria-label="Pendapatan marketplace">
      <div className="payout-heading">
        <div>
          <h2>Pendapatan marketplace</h2>
          <p>
            Saldo berasal dari penjualan template yang tercatat. Payout ditinjau
            manusia; PiwuApp tidak mengirim uang otomatis dan tidak menyimpan
            nomor rekening di luar data permintaan.
          </p>
        </div>
        <Wallet size={20} />
      </div>
      {error && <p className="payout-error">{error}</p>}
      {notice && (
        <p className="payout-notice" role="status">
          {notice}
        </p>
      )}
      {data?.applied === false && (
        <p className="payout-notice" role="status">
          {data.notice}
        </p>
      )}
      {data?.applied !== false && (
        <>
          <div className="payout-metrics">
            <div>
              <span>Terakru</span>
              <strong>{money(balance.accrued)}</strong>
              <small>Penjualan bersih yang tercatat</small>
            </div>
            <div>
              <span>Menunggu</span>
              <strong>{money(balance.pending)}</strong>
              <small>Permintaan yang belum dibayar</small>
            </div>
            <div>
              <span>Tersedia</span>
              <strong>{money(balance.available)}</strong>
              <small>Bisa diminta, minimal Rp50.000</small>
            </div>
            <div>
              <span>Sudah dibayar</span>
              <strong>{money(balance.paid)}</strong>
              <small>Payout dengan referensi transfer</small>
            </div>
            {Number(balance.frozen) > 0 && (
              <div>
                <span>Dibekukan sengketa</span>
                <strong>{money(balance.frozen)}</strong>
                <small>Tidak bisa dipayout sampai sengketa selesai</small>
              </div>
            )}
          </div>
          <div className="payout-grid">
            <div className="payout-card">
              <h3>
                <ShieldCheck size={15} /> Verifikasi penjual
              </h3>
              <p>
                Status: <b>{KYC_LABEL[status] || status}</b>
                {data?.verification?.note ? ` · ${data.verification.note}` : ""}
              </p>
              {!verified && (
                <form className="payout-form" onSubmit={submitKyc}>
                  <label>
                    Nama legal
                    <input
                      required
                      minLength={2}
                      maxLength={120}
                      value={kyc.legal_name}
                      onChange={(e) =>
                        setKyc({ ...kyc, legal_name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Nama usaha (opsional)
                    <input
                      maxLength={120}
                      value={kyc.business_name}
                      onChange={(e) =>
                        setKyc({ ...kyc, business_name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    NPWP / ID pajak (opsional)
                    <input
                      maxLength={40}
                      value={kyc.tax_id}
                      onChange={(e) =>
                        setKyc({ ...kyc, tax_id: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Negara
                    <input
                      required
                      minLength={2}
                      maxLength={56}
                      value={kyc.country}
                      onChange={(e) =>
                        setKyc({ ...kyc, country: e.target.value })
                      }
                    />
                  </label>
                  <button
                    className="button button-dark"
                    disabled={busy || status === "pending"}
                  >
                    {status === "pending"
                      ? "Menunggu tinjauan"
                      : "Kirim verifikasi"}
                  </button>
                </form>
              )}
            </div>
            <div className="payout-card">
              <h3>
                <Banknote size={15} /> Minta payout
              </h3>
              {verified ? (
                <form className="payout-form" onSubmit={submitPayout}>
                  <label>
                    Jumlah (Rp)
                    <input
                      inputMode="numeric"
                      required
                      value={request.amount}
                      onChange={(e) =>
                        setRequest({ ...request, amount: e.target.value })
                      }
                      placeholder="50000"
                    />
                  </label>
                  <label>
                    Metode
                    <select
                      value={request.method}
                      onChange={(e) =>
                        setRequest({ ...request, method: e.target.value })
                      }
                    >
                      <option value="bank">Transfer bank</option>
                      <option value="ewallet">E-wallet</option>
                    </select>
                  </label>
                  <label>
                    Tujuan (bank/nomor)
                    <input
                      required
                      minLength={4}
                      maxLength={120}
                      value={request.destination}
                      onChange={(e) =>
                        setRequest({ ...request, destination: e.target.value })
                      }
                      placeholder="BCA 1234567890 a.n. Nama"
                    />
                  </label>
                  <button
                    className="button button-dark"
                    disabled={busy || !canRequest}
                  >
                    Kirim permintaan
                  </button>
                  {!canRequest && (
                    <small>
                      Saldo tersedia minimal Rp50.000 sebelum payout bisa
                      diminta.
                    </small>
                  )}
                </form>
              ) : (
                <p className="payout-muted">
                  Payout terbuka setelah verifikasi penjual disetujui.
                </p>
              )}
            </div>
          </div>
          <h3 className="payout-history-title">Riwayat payout</h3>
          {!data.payouts?.length ? (
            <p className="payout-muted">Belum ada permintaan payout.</p>
          ) : (
            <div className="payout-table-wrap">
              <table className="payout-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Jumlah</th>
                    <th>Metode</th>
                    <th>Status</th>
                    <th>Referensi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.map((row: any) => (
                    <tr key={row.id}>
                      <td>
                        {new Date(row.created_at).toLocaleDateString("id-ID")}
                      </td>
                      <td>{money(row.amount)}</td>
                      <td>
                        {row.method === "bank" ? "Transfer bank" : "E-wallet"}
                      </td>
                      <td>
                        <span className={"payout-badge " + row.status}>
                          {PAYOUT_LABEL[row.status] || row.status}
                        </span>
                      </td>
                      <td>{row.reference || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
