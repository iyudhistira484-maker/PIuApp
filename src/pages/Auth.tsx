import ReadinessPanel from "../components/services/ReadinessPanel";
import WhatsAppLogin from "../components/services/WhatsAppLogin";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Mail,
  LockKeyhole,
  Check,
  LoaderCircle,
} from "lucide-react";
import { Logo } from "../components/ui";
import { supabase } from "../lib/supabase";
import { useStore } from "../lib/store";
export default function Auth() {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const store = useStore();
  const navigate = useNavigate();
  function next() {
    const destination = new URLSearchParams(location.search).get("next");
    if (
      destination?.startsWith("/") &&
      !destination.startsWith("//") &&
      !destination.includes("\\")
    ) {
      navigate(destination);
      return;
    }
    const s = useStore.getState();
    if (s.pendingPrompt) {
      const id =
        s.pendingProjectId &&
        s.projects.some((p) => p.id === s.pendingProjectId)
          ? s.pendingProjectId
          : s.createProject(s.pendingPrompt);
      navigate("/project/" + id);
    } else navigate("/projects");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!supabase) {
      setError(
        "Autentikasi belum dikonfigurasi. Hubungi pengelola untuk mengaktifkan Supabase. Tidak ada login simulasi.",
      );
      return;
    }
    setBusy(true);
    try {
      const { data, error } = signup
        ? await supabase.auth.signUp({
            email,
            password,
            options: { data: { name } },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.session && data.user) {
        store.setUser({
          id: data.user.id,
          email: data.user.email || "",
          name: name || data.user.user_metadata?.name || email.split("@")[0],
          demo: false,
        });
        next();
      } else
        setNotice(
          "Periksa email Anda untuk mengonfirmasi akun, kemudian masuk.",
        );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Tidak dapat masuk. Coba lagi.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    if (!supabase) {
      setError(
        "Login Google belum tersedia. Konfigurasi autentikasi diperlukan.",
      );
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/projects" },
    });
    if (error) setError(error.message);
  }
  return (
    <div className="auth-page">
      <section className="auth-main">
        <Logo />
        <div className="auth-form-wrap">
          <Link to="/" className="back-link">
            <ArrowLeft size={14} /> Kembali ke beranda
          </Link>
          <span className="eyebrow-label">IDE BESAR DIMULAI DI SINI</span>
          <h1>
            {signup ? "Ruang baru untuk ide Anda." : "Senang bertemu Anda."}
          </h1>
          <p>
            {signup
              ? "Buat akun dan mulai sesuatu yang berarti."
              : "Masuk untuk melanjutkan ide yang belum selesai."}
          </p>
          <button
            className="button button-outline oauth-button"
            onClick={google}
            disabled={busy}
          >
            <span className="google-letter">G</span>Lanjutkan dengan Google
          </button>
          <WhatsAppLogin onSuccess={next} />
          <div className="auth-divider">
            <span />
            atau dengan email
            <span />
          </div>
          <form onSubmit={submit}>
            {signup && (
              <label>
                Nama lengkap
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama Anda"
                />
              </label>
            )}
            <label>
              Alamat email
              <div className="input-with-icon">
                <Mail size={17} />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="anda@email.com"
                />
              </div>
            </label>
            <label>
              Kata sandi
              <div className="input-with-icon">
                <LockKeyhole size={17} />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={signup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 8 karakter"
                />
              </div>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="form-success" role="status">
                {notice}
              </p>
            )}
            <button className="button button-dark full-width" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <>
                  {signup ? "Buat akun" : "Masuk"}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          {!signup && (
            <Link className="back-link" to="/forgot-password">
              Lupa kata sandi?
            </Link>
          )}
          <p className="auth-switch">
            {signup ? "Sudah punya akun?" : "Belum punya akun?"}{" "}
            <button
              onClick={() => {
                setSignup(!signup);
                setError("");
              }}
            >
              {signup ? "Masuk" : "Daftar gratis"}
            </button>
          </p>
          <ReadinessPanel />
        </div>
        <p className="auth-legal">
          Dengan melanjutkan, Anda memahami ini adalah versi pengembangan
          PiwuApp.
        </p>
      </section>
      <aside className="auth-art">
        <div className="auth-art-grid" />
        <div className="auth-art-top">
          <span>SEBUAH RUANG UNTUK KEMUNGKINAN.</span>
          <span>01 / ∞</span>
        </div>
        <div className="auth-orb">
          <div />
          <span>p.</span>
        </div>
        <div className="auth-art-copy">
          <span className="eyebrow-label">DARI IDE, JADI NYATA.</span>
          <h2>
            Yang besar,
            <br />
            bermula dari
            <br />
            <em>satu ide.</em>
          </h2>
          <p>
            Website pertama. Bisnis berikutnya.
            <br />
            Atau sesuatu yang belum pernah ada.
          </p>
          <div>
            <Check size={14} /> Miliki ide Anda. Miliki kodenya.
          </div>
        </div>
        <span className="auth-art-bottom">
          DIBANGUN DI INDONESIA. UNTUK SEMUA.
        </span>
      </aside>
    </div>
  );
}
