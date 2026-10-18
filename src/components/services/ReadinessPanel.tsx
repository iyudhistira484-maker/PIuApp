import { useEffect, useState } from "react";
import { api } from "../../services/api";
import "./readiness.css";
const labels: Record<string, string> = {
  reachable: "Koneksi terverifikasi",
  configured_unverified: "Dikonfigurasi · belum diuji",
  not_configured: "Belum dikonfigurasi",
  unreachable: "Tidak dapat dijangkau",
  schema_missing: "Migrasi database diperlukan",
  rejected: "Koneksi ditolak",
};
const services = {
  auth: "Autentikasi",
  database: "Database project",
  datasets: "Tabel data project",
  administration: "Skema administrasi",
  studio: "Penyimpanan Studio Bridge",
  ai: "AI",
  sandbox: "Terminal & runtime",
  payments: "Pembayaran",
  whatsapp: "Login WhatsApp",
  secrets: "Enkripsi secrets",
};
export default function ReadinessPanel() {
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Record<string, string>>(
      "/public/readiness",
      undefined,
      "GET",
      AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Status koneksi belum dapat diperiksa. Coba kembali.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <section
      className="readiness-panel"
      aria-label="Status layanan nyata"
      aria-busy={loading}
    >
      <div className="readiness-heading">
        <strong>Akun nyata, layanan nyata</strong>
        <button disabled={loading} onClick={() => setAttempt((n) => n + 1)}>
          {loading ? "Memeriksa…" : "Periksa lagi"}
        </button>
      </div>
      <p>
        Masuk melalui autentikasi server. Tidak ada akun demo atau jawaban AI
        simulasi.
      </p>
      {error && <p role="alert">{error}</p>}
      {data && (
        <details>
          <summary>Lihat kesiapan layanan</summary>
          <dl>
            {Object.entries(services).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {labels[data[key]] || "Belum diketahui"}
                  {key === "payments" && data.payments !== "not_configured"
                    ? ` · ${data.paymentMode}`
                    : ""}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Pemeriksaan hanya membaca koneksi autentikasi, tabel inti, dan
            penanda skema data/admin/Studio. Bukan verifikasi seluruh migrasi,
            inference AI, pengiriman pesan, atau transaksi. Hasil disimpan
            sementara selama 30 detik.
          </p>
        </details>
      )}
      {data &&
        ["auth", "database"].some((key) => data[key] !== "reachable") && (
          <p role="status">
            Koneksi akun atau database belum siap. Pengelola perlu menyelesaikan
            aktivasi sebelum workspace cloud dapat digunakan.
          </p>
        )}
    </section>
  );
}
