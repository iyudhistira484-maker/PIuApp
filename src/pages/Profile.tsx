import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useStore } from "../lib/store";
import { api } from "../services/api";
import { Logo } from "../components/ui";
import {
  NAME_MAX,
  PASSWORD_MIN,
  changedFields,
  shortId,
  validateEmail,
  validateName,
  validatePassword,
} from "../lib/profile";
import { periodLeft, rupiah } from "../lib/dashboard/plans";
import PayoutSection from "../components/services/PayoutSection";
import DisputeSection from "../components/services/DisputeSection";
import "../components/services/services.css";
import "../components/services/profile.css";

type Notice = { kind: "ok" | "error"; text: string } | null;

/**
 * The profile page: the display name, the email on record, the password, and
 * what the account is currently on (plan, credits, workspaces).
 *
 * Everything that changes account data goes straight to Supabase auth with the
 * verified session — no server route and no new table. When a change needs
 * confirmation (email), the page says so instead of pretending it is done.
 */
export default function Profile({
  embedded = false,
}: {
  /** Rendered inside the dashboard: no page header, same forms. */
  embedded?: boolean;
} = {}) {
  const user = useStore((s) => s.user);
  const projects = useStore((s) => s.projects.length);
  const connection = useStore((s) => s.connection);
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [account, setAccount] = useState<any>(null);
  const [accountError, setAccountError] = useState("");
  const [identity, setIdentity] = useState<any>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState("");

  const signedIn = Boolean(user && !user.demo);
  useEffect(() => setName(user?.name || ""), [user?.name]);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api("/account")
      .then((d) => {
        if (alive) setAccount(d);
      })
      .catch((e) => {
        if (alive)
          setAccountError(e instanceof Error ? e.message : "Gagal dimuat.");
      });
    // Verification status and provider come from the auth service itself.
    supabase?.auth
      .getUser()
      .then(({ data }) => {
        if (alive) setIdentity(data?.user || null);
      })
      .catch(() => {
        if (alive) setIdentity(null);
      });
    return () => {
      alive = false;
    };
  }, [signedIn, user?.id]);

  /** Runs one auth update, keeping the account id it started under. */
  async function authUpdate(
    label: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (!supabase) {
      setNotice({
        kind: "error",
        text: "Autentikasi cloud belum dikonfigurasi, jadi tidak ada perubahan akun yang dikirim.",
      });
      return false;
    }
    const started = user?.id;
    setNotice(null);
    setBusy(label);
    try {
      const { error } = await supabase.auth.updateUser(payload as any);
      if (error) throw error;
      if (useStore.getState().user?.id !== started)
        throw new Error(
          "Sesi berubah saat perubahan dikirim. Periksa akun yang aktif sebelum melanjutkan.",
        );
      return true;
    } catch (e) {
      setNotice({
        kind: "error",
        text:
          e instanceof Error
            ? e.message
            : "Layanan autentikasi tidak dapat menyelesaikan permintaan.",
      });
      return false;
    } finally {
      setBusy("");
    }
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const parsed = validateName(name);
    if (parsed.error) return setNotice({ kind: "error", text: parsed.error });
    const changed = changedFields(
      { name: user?.name, email: user?.email },
      { name: parsed.value },
    );
    if (!changed.name)
      return setNotice({
        kind: "ok",
        text: "Nama tampilan sudah itu juga, jadi tidak ada yang dikirim ke server.",
      });
    if (await authUpdate("nama", { data: { name: changed.name } })) {
      setName(changed.name);
      setNotice({
        kind: "ok",
        text: "Nama tampilan diperbarui oleh layanan autentikasi dan langsung dipakai di sidebar.",
      });
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    const error = validatePassword(password, confirm);
    if (error) return setNotice({ kind: "error", text: error });
    if (await authUpdate("password", { password })) {
      setPassword("");
      setConfirm("");
      setNotice({
        kind: "ok",
        text: "Kata sandi dikirim ke layanan autentikasi. Sesi lain tetap aktif sampai kadaluarsa — keluar dari semua perangkat bila perlu.",
      });
    }
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    const error = validateEmail(email, user?.email);
    if (error) return setNotice({ kind: "error", text: error });
    if (await authUpdate("email", { email })) {
      setEmail("");
      setNotice({
        kind: "ok",
        text: "Permintaan perubahan email diterima. Alamat baru berlaku setelah tautan konfirmasi di email itu dibuka; sampai saat itu email lama tetap dipakai.",
      });
    }
  }

  async function signOut(everywhere: boolean) {
    if (!supabase) {
      useStore.getState().setUser(null);
      navigate("/");
      return;
    }
    setBusy(everywhere ? "keluar-semua" : "keluar");
    const { error } = await supabase.auth.signOut(
      everywhere ? undefined : { scope: "local" },
    );
    setBusy("");
    if (error) {
      setNotice({
        kind: "error",
        text: "Tidak dapat menutup sesi: " + error.message,
      });
      return;
    }
    useStore.getState().setUser(null);
    navigate("/");
  }

  const plan = account?.plan?.plan || "Free";
  const left = periodLeft(account?.plan?.current_period_end);
  const connectionText = {
    local: "Belum tersinkron dari peramban ini",
    loading: "Sedang menyinkronkan",
    ready: "Tersinkron dengan akun",
    offline: "Terputus — salinan lokal tetap utuh",
    error: connection.error || "Sinkronisasi gagal",
  }[connection.phase];

  const Shell = embedded ? "div" : "main";
  return (
    <Shell
      className={embedded ? "profile-embedded" : "service-page profile-page"}
    >
      {!embedded && (
        <header>
          <Logo />
          <nav>
            <Link to="/projects">Project</Link>
            <Link to="/upgrade">Paket</Link>
            <Link to="/account">Akun &amp; kredit</Link>
          </nav>
        </header>
      )}
      {!embedded && (
        <>
          <span className="eyebrow-label">PIWUAPP / PROFIL</span>
          <h1>Jejak akun Anda.</h1>
        </>
      )}

      {!signedIn && (
        <section className="service-panel">
          <div className="service-error" role="alert">
            Profil hanya tersedia untuk akun cloud yang sudah masuk. Tidak ada
            perubahan data yang bisa dikirim tanpa sesi terverifikasi.
            <div className="service-actions">
              <Link to={"/login?next=" + encodeURIComponent("/profile")}>
                Masuk ke akun cloud
              </Link>
            </div>
          </div>
        </section>
      )}

      {signedIn && (
        <section className="service-panel" aria-busy={Boolean(busy)}>
          {notice && (
            <div
              className={
                notice.kind === "ok" ? "service-notice" : "service-error"
              }
              role={notice.kind === "ok" ? "status" : "alert"}
            >
              {notice.text}
            </div>
          )}

          <div className="profile-head">
            <span className="profile-avatar" aria-hidden="true">
              {user?.name?.[0]?.toUpperCase() || "P"}
            </span>
            <div>
              <b>{user?.name}</b>
              <small>{user?.email}</small>
              <small className="profile-id">
                ID akun: <code>{shortId(user?.id) || "—"}</code>
                {identity?.email_confirmed_at
                  ? " · email terverifikasi"
                  : identity
                    ? " · email belum terverifikasi"
                    : " · status verifikasi belum terbaca"}
              </small>
            </div>
          </div>

          <div className="profile-grid">
            <section className="profile-card">
              <h2>Identitas</h2>
              <form onSubmit={saveName}>
                <label>
                  Nama tampilan
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={NAME_MAX}
                    autoComplete="name"
                  />
                </label>
                <button disabled={Boolean(busy)}>
                  {busy === "nama" ? "Menyimpan…" : "Simpan nama"}
                </button>
              </form>
              <form onSubmit={saveEmail}>
                <label>
                  Email pengganti
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={user?.email || "anda@email.com"}
                    autoComplete="email"
                  />
                </label>
                <p className="profile-hint">
                  Email lama <b>{user?.email}</b> tetap dipakai sampai alamat
                  baru dikonfirmasi.
                </p>
                <button disabled={Boolean(busy) || !email}>
                  {busy === "email" ? "Mengirim…" : "Ajukan perubahan email"}
                </button>
              </form>
            </section>

            <section className="profile-card">
              <h2>Keamanan</h2>
              <form onSubmit={savePassword}>
                <label>
                  Kata sandi baru
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Ulangi kata sandi
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <p className="profile-hint">
                  Minimal {PASSWORD_MIN} karakter. Kebijakan layanan autentikasi
                  tetap berlaku dan dapat menolak kata sandi yang lemah.
                </p>
                <button disabled={Boolean(busy) || !password}>
                  {busy === "password" ? "Mengirim…" : "Ganti kata sandi"}
                </button>
              </form>
              <div className="profile-actions">
                <button
                  className="button button-outline"
                  onClick={() => void signOut(false)}
                  disabled={Boolean(busy)}
                >
                  Keluar dari perangkat ini
                </button>
                <button
                  className="button button-outline"
                  onClick={() => void signOut(true)}
                  disabled={Boolean(busy)}
                >
                  {busy === "keluar-semua"
                    ? "Menutup semua sesi…"
                    : "Keluar dari semua perangkat"}
                </button>
              </div>
            </section>

            <section className="profile-card">
              <h2>Paket &amp; kredit</h2>
              {!account && !accountError && (
                <p role="status">Memuat paket dan saldo…</p>
              )}
              {accountError && (
                <p className="profile-hint" role="alert">
                  {accountError} Paket dan saldo tidak ditampilkan daripada
                  menampilkan angka yang salah.
                </p>
              )}
              {account && (
                <>
                  <div className="profile-metrics">
                    <div>
                      <span>Paket aktif</span>
                      <strong>{plan}</strong>
                      <small>{left || "Tanpa masa aktif berbayar"}</small>
                    </div>
                    <div>
                      <span>Kredit</span>
                      <strong>
                        {Number(account.balance || 0).toLocaleString("id-ID")}
                      </strong>
                      <small>Ledger 30 entri terakhir di halaman akun</small>
                    </div>
                    <div>
                      <span>Pendapatan tercatat</span>
                      <strong>
                        {rupiah(
                          (account.sales || [])
                            .filter((s: any) => s.status === "accrued")
                            .reduce((n: number, s: any) => n + s.net, 0),
                        )}
                      </strong>
                      <small>
                        Bukan saldo siap cair; payout belum otomatis
                      </small>
                    </div>
                  </div>
                  <div className="profile-actions">
                    <Link className="button button-dark" to="/upgrade">
                      Upgrade paket
                    </Link>
                    <Link className="button button-outline" to="/account">
                      Riwayat &amp; pesanan
                    </Link>
                  </div>
                </>
              )}
            </section>
            {signedIn && <PayoutSection />}
            {signedIn && <DisputeSection />}

            <section className="profile-card">
              <h2>Workspace</h2>
              <div className="profile-metrics">
                <div>
                  <span>Project di peramban ini</span>
                  <strong>{projects}</strong>
                  <small>Salinan lokal selalu ada lebih dulu</small>
                </div>
                <div>
                  <span>Sinkronisasi akun</span>
                  <strong className="profile-sync">{connectionText}</strong>
                  <small>
                    {connection.refreshedAt
                      ? "Terakhir diperiksa " +
                        new Date(connection.refreshedAt).toLocaleString("id-ID")
                      : "Belum ada pemeriksaan pada sesi ini"}
                  </small>
                </div>
              </div>
              <p className="profile-hint">
                Penghapusan akun belum tersedia dari halaman ini; tidak ada
                tombol yang berpura-pura melakukannya. Cadangan project bisa
                dibuat dari dialog Penyimpanan di dashboard.
              </p>
              {!embedded && (
                <div className="profile-actions">
                  <Link className="button button-outline" to="/projects">
                    Buka dashboard
                  </Link>
                </div>
              )}
            </section>
          </div>
        </section>
      )}
    </Shell>
  );
}
