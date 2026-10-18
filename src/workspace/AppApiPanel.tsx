import { useEffect, useState } from "react";
import { KeyRound, Copy, RefreshCw, Trash2, PlugZap } from "lucide-react";
import { api } from "../services/api";
import { useStore } from "../lib/store";
import type { AccessRole } from "../lib/cloud/types";
import "./data.css";

type KeyRow = {
  id: string;
  label: string;
  scope: "read" | "write";
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
};

const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Belum dipakai";

/**
 * The data API for the app being built: revocable per-project keys, read by
 * default. The plaintext key is shown once; only its SHA-256 hash is stored.
 */
export default function AppApiPanel({
  projectId,
  role,
}: {
  projectId: string;
  role: AccessRole;
}) {
  const canEdit = role === "Owner" || role === "Editor";
  const user = useStore((s) => s.user);
  const signedIn = !!user && !user.demo;
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [secret, setSecret] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState("");
  const [copied, setCopied] = useState("");

  const base =
    (typeof location !== "undefined" ? location.origin : "") +
    "/api/public/app/" +
    projectId;

  const load = () => {
    if (!signedIn) return Promise.resolve();
    return api<{ keys: KeyRow[] }>("/projects/" + projectId + "/app-keys")
      .then((data) => {
        setKeys(data.keys || []);
        setError("");
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Kunci API gagal dimuat."),
      );
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, signedIn]);

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
      setError(
        "Peramban menolak akses clipboard. Salin teksnya secara manual dari kotak di atas.",
      );
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api<{ secret: string; key: KeyRow; notice?: string }>(
        "/projects/" + projectId + "/app-keys",
        { label, scope },
      );
      setSecret(data.secret);
      setLabel("");
      setScope("read");
      setNotice(data.notice || "Kunci dibuat.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunci gagal dibuat.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/projects/" + projectId + "/app-keys/" + id, {}, "DELETE");
      setConfirmRevoke("");
      setNotice(
        "Kunci dicabut. Permintaan berikutnya dengan kunci itu ditolak.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunci gagal dicabut.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="app-api" aria-label="API data aplikasi">
      <header className="app-api-head">
        <div>
          <h2>
            <PlugZap size={16} /> API data untuk aplikasi Anda
          </h2>
          <p>
            Aplikasi hasil build bisa membaca dan menulis tabel project ini
            tanpa sesi pengguna, memakai kunci yang bisa dicabut. Kunci hanya
            ditampilkan sekali; server menyimpan hash-nya.
          </p>
        </div>
        <button
          className="app-api-action"
          disabled={busy}
          onClick={() => void load()}
          title="Muat ulang daftar kunci"
        >
          <RefreshCw size={14} /> Muat ulang
        </button>
      </header>
      {error && <p className="app-api-error">{error}</p>}
      {notice && <p className="app-api-ok">{notice}</p>}

      {!signedIn && (
        <p className="app-api-note">
          Masuk dengan akun terverifikasi untuk mengelola kunci API. Data dan
          kunci hanya tersedia di project cloud, bukan project demo.
        </p>
      )}

      {signedIn && !canEdit && (
        <p className="app-api-note">
          Hanya Owner dan Editor project yang dapat membuat atau mencabut kunci.
          Anda tetap dapat membaca daftar kunci yang ada.
        </p>
      )}

      {secret && (
        <div className="app-api-secret">
          <strong>
            <KeyRound size={15} /> Kunci baru — salin sekarang
          </strong>
          <code>{secret}</code>
          <div>
            <button
              className="button button-dark"
              onClick={() => void copy(secret, "secret")}
            >
              <Copy size={14} />{" "}
              {copied === "secret" ? "Tersalin" : "Salin kunci"}
            </button>
            <button className="app-api-action" onClick={() => setSecret("")}>
              Sembunyikan
            </button>
          </div>
          <small>
            Kunci ini tidak bisa ditampilkan lagi. Jika hilang, buat kunci baru
            lalu cabut yang lama.
          </small>
        </div>
      )}

      {signedIn && canEdit && (
        <form className="app-api-form" onSubmit={create}>
          <label>
            Nama kunci
            <input
              required
              minLength={1}
              maxLength={60}
              value={label}
              disabled={busy}
              placeholder="Web publik, aplikasi mobile, bot…"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            Akses
            <select
              value={scope}
              disabled={busy}
              onChange={(e) => setScope(e.target.value as "read" | "write")}
            >
              <option value="read">Baca saja (disarankan)</option>
              <option value="write">Baca &amp; tulis</option>
            </select>
          </label>
          <button className="button button-dark" disabled={busy}>
            Buat kunci
          </button>
          <p className="app-api-note">
            Kunci yang ditanam di aplikasi web bisa dilihat siapa pun yang
            membuka DevTools. Pakai <b>baca saja</b> untuk aplikasi klien dan
            simpan kunci tulis di server Anda sendiri.
          </p>
        </form>
      )}

      <h3>Kunci project</h3>
      {!signedIn ? null : !keys ? (
        <p className="app-api-note">Memuat kunci…</p>
      ) : !keys.length ? (
        <p className="app-api-note">
          Belum ada kunci. Aplikasi tidak bisa membaca data sampai kunci dibuat
          dan dicantumkan sebagai header <code>x-piwu-key</code>.
        </p>
      ) : (
        <div className="app-api-keys">
          {keys.map((key) => (
            <article className={key.revoked ? "revoked" : ""} key={key.id}>
              <div>
                <strong>{key.label}</strong>
                <span className={"app-api-scope " + key.scope}>
                  {key.scope === "write" ? "Baca & tulis" : "Baca saja"}
                </span>
                {key.revoked && (
                  <span className="app-api-scope revoked">Dicabut</span>
                )}
              </div>
              <small>
                Dibuat {date(key.created_at)} · terakhir dipakai{" "}
                {date(key.last_used_at)}
              </small>
              {!key.revoked && canEdit && (
                <div className="app-api-revoke">
                  {confirmRevoke === key.id ? (
                    <>
                      <button
                        className="app-api-action app-api-danger"
                        disabled={busy}
                        onClick={() => void revoke(key.id)}
                      >
                        Yakin cabut?
                      </button>
                      <button
                        className="app-api-action"
                        onClick={() => setConfirmRevoke("")}
                      >
                        Batal
                      </button>
                    </>
                  ) : (
                    <button
                      className="app-api-action app-api-danger"
                      onClick={() => setConfirmRevoke(key.id)}
                      title="Permintaan dengan kunci ini langsung ditolak."
                    >
                      <Trash2 size={14} /> Cabut
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <h3>Endpoint</h3>
      <div className="app-api-endpoints">
        <div>
          <code>GET {base}</code>
          <small>Daftar tabel (id, nama, revisi, jumlah baris)</small>
        </div>
        <div>
          <code>GET {base}/:tableId</code>
          <small>Semua baris satu tabel (maksimum 1.000)</small>
        </div>
        <div>
          <code>POST {base}/:tableId</code>
          <small>
            Tambah 1–50 baris:{" "}
            <code>{'{"rows":[{"values":{"kolom":"nilai"}}]}'}</code>
          </small>
        </div>
        <div>
          <code>PATCH {base}/:tableId/:rowId</code>
          <small>
            Ubah sebagian nilai: <code>{'{"values":{"kolom":"nilai"}}'}</code>
          </small>
        </div>
        <div>
          <code>DELETE {base}/:tableId/:rowId</code>
          <small>Hapus satu baris (butuh kunci tulis)</small>
        </div>
      </div>
      <pre className="app-api-example">
        <code>{"curl -H 'x-piwu-key: <kunci>' " + base + "/<tableId>"}</code>
      </pre>
      <h3>Contoh Roblox (HttpService)</h3>
      <p className="app-api-note">
        Jalankan di Script server, bukan LocalScript. Di Game Settings →
        Security, HttpService dan permintaan HTTP harus aktif. Kunci yang
        tertanam di place dapat dibaca dari berkas place, jadi pakai kunci baca
        saja; operasi tulis sebaiknya lewat server Anda sendiri.
      </p>
      <pre className="app-api-example">
        <code>{`local HttpService = game:GetService("HttpService")
local KEY = "<kunci>"
local URL = "${base}/<tableId>"

local res = HttpService:RequestAsync({
  Url = URL,
  Method = "GET",
  Headers = { ["x-piwu-key"] = KEY },
})
if not res.Success then
  warn("PIWU", res.StatusCode, res.Body)
  return
end
local rowData = HttpService:JSONDecode(res.Body).table
print(rowData.name, #rowData.rows)`}</code>
      </pre>
      <p className="app-api-note">
        Nilai kolom harus sesuai tipenya: <code>text</code>, <code>number</code>
        , atau <code>boolean</code> (ya/tidak). Baris yang ditolak tidak
        disimpan sebagian; seluruh permintaan dibatalkan.
      </p>
      <p className="app-api-note">
        Batas: 1.000 baris, 32 kolom, dan 2 MB per tabel mengikuti batas data
        cloud. Kunci hanya memberi akses ke tabel project ini — bukan ke file
        project, storage, atau akun pengguna. Tidak ada autentikasi per pengguna
        akhir, kuota per kunci, atau webhook; rate limit berlaku per alamat IP.
        Header CORS dibuka hanya untuk endpoint ini agar aplikasi dari domain
        lain bisa memanggilnya.
      </p>
    </section>
  );
}
