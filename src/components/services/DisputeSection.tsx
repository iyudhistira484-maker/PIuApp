import { useEffect, useState } from "react";
import { MessageSquareWarning, ShieldQuestion } from "lucide-react";
import { api } from "../../services/api";
import "./services.css";

const CATEGORY: Record<string, string> = {
  not_as_described: "Tidak sesuai deskripsi",
  broken: "Rusak / tidak bisa dipakai",
  access: "Tidak bisa diakses",
  other: "Lainnya",
};
const STATUS: Record<string, string> = {
  open: "Menunggu penjual",
  seller_replied: "Dibalas penjual",
  resolved: "Ditutup",
  rejected: "Laporan ditolak",
  withdrawn: "Ditarik pelapor",
};
const date = (value: string) =>
  new Date(value).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/**
 * Buyer reports and seller replies for purchases. The decision belongs to a
 * superadmin. PiwuApp never refunds a transaction: an unresolved report holds
 * the seller's share, and closing the report releases it without moving money.
 */
export default function DisputeSection() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    orderId: "",
    category: "not_as_described",
    body: "",
  });
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [confirmWithdraw, setConfirmWithdraw] = useState("");

  const load = () =>
    api("/marketplace/disputes")
      .then((d) => {
        setData(d);
        setError("");
        const open = (d.purchases || []).filter((row: any) => row.can_open);
        setForm((old) => ({
          ...old,
          orderId: open.some((row: any) => row.order_id === old.orderId)
            ? old.orderId
            : open[0]?.order_id || "",
        }));
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Sengketa gagal dimuat."),
      );

  useEffect(() => {
    void load();
  }, []);

  const run = async (
    work: () => Promise<any>,
    ok: string,
    done?: () => void,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      done?.();
      setNotice(ok);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tindakan gagal.");
    } finally {
      setBusy(false);
    }
  };

  const open = (event: React.FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        api("/marketplace/disputes", {
          orderId: form.orderId,
          category: form.category,
          body: form.body.trim(),
        }),
      "Laporan terkirim. Penjual mendapat notifikasi dan punya kesempatan membalas.",
      () => setForm((old) => ({ ...old, body: "" })),
    );
  };

  if (!data) {
    return (
      <section
        id="sengketa"
        className="dispute-section"
        aria-label="Sengketa marketplace"
      >
        <div className="payout-heading">
          <div>
            <h2>Sengketa marketplace</h2>
            <p>Laporan pembeli dan balasan penjual dimuat dari server.</p>
          </div>
          <ShieldQuestion size={20} />
        </div>
        {error ? (
          <p className="payout-error">{error}</p>
        ) : (
          <p className="payout-loading">Memuat sengketa…</p>
        )}
      </section>
    );
  }
  const eligible = (data.purchases || []).filter((row: any) => row.can_open);
  return (
    <section
      id="sengketa"
      className="dispute-section"
      aria-label="Sengketa marketplace"
    >
      <div className="payout-heading">
        <div>
          <h2>Sengketa marketplace</h2>
          <p>
            Laporan dibuka paling lambat 30 hari setelah pembelian dan hanya
            sekali per pesanan. <b>Pembelian tidak dapat direfund</b> — laporan
            ini untuk menyelesaikan masalah (misalnya file rusak atau akses),
            bukan untuk mengembalikan uang. Selama laporan belum selesai, bagian
            penjual dari penjualan itu ditahan dari saldo payout; begitu
            ditutup, ditolak, atau ditarik, saldo itu kembali tersedia.
          </p>
        </div>
        <ShieldQuestion size={20} />
      </div>
      {error && <p className="payout-error">{error}</p>}
      {notice && (
        <p className="payout-notice" role="status">
          {notice}
        </p>
      )}
      {data.applied === false && <p className="payout-notice">{data.notice}</p>}
      {data.applied !== false && (
        <>
          <h3 className="payout-history-title">
            <MessageSquareWarning size={15} /> Laporkan pembelian
          </h3>
          {!eligible.length ? (
            <p className="payout-muted">
              Tidak ada pembelian yang bisa dilaporkan. Pesanan yang sudah punya
              sengketa atau lebih dari 30 hari tidak muncul di sini.
            </p>
          ) : (
            <form className="payout-form dispute-form" onSubmit={open}>
              <label>
                Pembelian
                <select
                  value={form.orderId}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({ ...form, orderId: e.target.value })
                  }
                >
                  {eligible.map((row: any) => (
                    <option key={row.order_id} value={row.order_id}>
                      {row.title} · {date(row.acquired_at)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Jenis masalah
                <select
                  value={form.category}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  {Object.entries(CATEGORY).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Penjelasan (20–2.000 karakter)
                <textarea
                  required
                  minLength={20}
                  maxLength={2000}
                  rows={3}
                  value={form.body}
                  disabled={busy}
                  placeholder="Sebutkan apa yang berbeda dari deskripsi atau apa yang gagal dipakai…"
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              </label>
              <button className="button button-dark" disabled={busy}>
                Kirim laporan
              </button>
            </form>
          )}

          <h3 className="payout-history-title">Laporan saya</h3>
          {!data.as_buyer?.length ? (
            <p className="payout-muted">
              Anda belum pernah melaporkan pembelian.
            </p>
          ) : (
            <div className="dispute-list">
              {data.as_buyer.map((row: any) => (
                <article className="dispute-card" key={row.id}>
                  <header>
                    <strong>{row.title}</strong>
                    <span className={"payout-badge " + row.status}>
                      {STATUS[row.status] || row.status}
                    </span>
                  </header>
                  <small>
                    {CATEGORY[row.category] || row.category} ·{" "}
                    {date(row.opened_at)} · penjual {row.counterparty || "—"}
                  </small>
                  <p>{row.body}</p>
                  {row.seller_reply && (
                    <p className="dispute-reply">
                      <b>Balasan penjual:</b> {row.seller_reply}
                    </p>
                  )}
                  {row.resolution_note && (
                    <p className="dispute-reply">
                      <b>Keputusan:</b> {row.resolution_note}
                    </p>
                  )}
                  {["open", "seller_replied"].includes(row.status) &&
                    (confirmWithdraw === row.id ? (
                      <div className="dispute-actions">
                        <button
                          className="ad-action ad-danger"
                          disabled={busy}
                          onClick={() => {
                            setConfirmWithdraw("");
                            void run(
                              () =>
                                api(
                                  "/marketplace/disputes/" +
                                    row.id +
                                    "/withdraw",
                                  {},
                                ),
                              "Laporan ditarik. Saldo penjual untuk pesanan ini dibuka kembali.",
                            );
                          }}
                        >
                          Yakin tarik laporan?
                        </button>
                        <button
                          className="ad-action"
                          onClick={() => setConfirmWithdraw("")}
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        className="ad-action"
                        onClick={() => setConfirmWithdraw(row.id)}
                      >
                        Tarik laporan
                      </button>
                    ))}
                </article>
              ))}
            </div>
          )}

          <h3 className="payout-history-title">Terhadap penjualan saya</h3>
          {!data.as_seller?.length ? (
            <p className="payout-muted">
              Tidak ada sengketa atas penjualan Anda.
            </p>
          ) : (
            <div className="dispute-list">
              {data.as_seller.map((row: any) => (
                <article className="dispute-card" key={row.id}>
                  <header>
                    <strong>{row.title}</strong>
                    <span className={"payout-badge " + row.status}>
                      {STATUS[row.status] || row.status}
                    </span>
                  </header>
                  <small>
                    {CATEGORY[row.category] || row.category} ·{" "}
                    {date(row.opened_at)} · pembeli {row.counterparty || "—"}
                  </small>
                  <p>{row.body}</p>
                  {row.seller_reply && (
                    <p className="dispute-reply">
                      <b>Balasan Anda:</b> {row.seller_reply}
                    </p>
                  )}
                  {row.status === "open" && (
                    <div className="dispute-reply-form">
                      <textarea
                        rows={2}
                        minLength={10}
                        maxLength={2000}
                        placeholder="Jelaskan perbaikan atau alasan (minimal 10 karakter)…"
                        value={replies[row.id] || ""}
                        disabled={busy}
                        onChange={(e) =>
                          setReplies({ ...replies, [row.id]: e.target.value })
                        }
                      />
                      <button
                        className="button button-dark"
                        disabled={
                          busy || (replies[row.id] || "").trim().length < 10
                        }
                        onClick={() =>
                          void run(
                            () =>
                              api(
                                "/marketplace/disputes/" + row.id + "/reply",
                                { body: replies[row.id].trim() },
                              ),
                            "Balasan terkirim. Pembeli mendapat notifikasi.",
                            () =>
                              setReplies((old) => ({ ...old, [row.id]: "" })),
                          )
                        }
                      >
                        Kirim balasan
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
