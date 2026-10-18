import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Github,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  parseRepo,
  pushToGithub,
  selectFiles,
  validBranch,
  type GithubPushResult,
} from "../../lib/github";
import "./services.css";

/**
 * Push the open project to an existing GitHub repository. OAuth tokens come
 * from the Supabase session; a personal token is kept in component state only.
 * Neither is sent to PiwuApp's server.
 */
export default function GitHubPanel({
  files,
  projectName,
  onExport,
}: {
  files: Record<string, string>;
  projectName: string;
  onExport?: () => void;
}) {
  const [sessionToken, setSessionToken] = useState("");
  const [pat, setPat] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [message, setMessage] = useState(
    `Perbarui ${projectName} dari PiwuApp`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [oauthError, setOauthError] = useState("");
  const [result, setResult] = useState<GithubPushResult | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive && data.session?.provider_token)
          setSessionToken(data.session.provider_token);
      })
      .catch(() => {
        // A session read is best-effort; the token field still works.
      });
    return () => {
      alive = false;
    };
  }, []);

  const selection = useMemo(() => selectFiles(files), [files]);
  const token = pat.trim() || sessionToken;
  const parsed = parseRepo(repo);
  const branchOk = validBranch(branch);
  const canPush =
    !!token &&
    !!parsed &&
    branchOk &&
    message.trim().length > 0 &&
    selection.files.length > 0 &&
    !busy;

  const connect = async () => {
    if (!supabase) {
      setOauthError(
        "Supabase belum dikonfigurasi di build ini. Gunakan token akses di bawah.",
      );
      return;
    }
    setOauthError("");
    const { error } = await supabase.auth.linkIdentity({
      provider: "github",
      options: { scopes: "repo", redirectTo: window.location.href },
    });
    if (error) setOauthError(error.message);
  };

  const submit = async () => {
    if (!parsed) {
      setError("Tulis repositori sebagai owner/nama-repo.");
      return;
    }
    if (!branchOk) {
      setError("Nama cabang tidak valid.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const pushed = await pushToGithub(
        token,
        {
          owner: parsed.owner,
          repo: parsed.repo,
          branch: branch.trim(),
          message: message.trim(),
        },
        files,
      );
      setResult(pushed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Push ke GitHub gagal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="github-panel">
      <p>
        Push mengirim <b>file teks</b> project ke repositori GitHub yang sudah
        ada. Gambar, GLB, ZIP, dan file <code>.env</code> dilewati; file yang
        Anda hapus di PiwuApp tidak dihapus dari repositori. Tidak ada
        kredensial yang dikirim ke server PiwuApp.
      </p>
      <div className="integration-row">
        <span>
          <Github size={16} />
          {sessionToken ? "GitHub terhubung" : "GitHub belum terhubung"}
        </span>
        <small>{sessionToken ? "lewat sesi Supabase" : "OAuth opsional"}</small>
      </div>
      <button
        type="button"
        className="button button-outline full-width"
        onClick={() => void connect()}
        disabled={busy}
      >
        <Github size={14} />
        Hubungkan dengan GitHub
      </button>
      {oauthError && (
        <p className="github-error" role="alert">
          {oauthError}
        </p>
      )}
      <label className="github-field">
        Token akses GitHub
        <input
          type="password"
          autoComplete="off"
          value={pat}
          disabled={busy}
          onChange={(e) => setPat(e.target.value)}
          placeholder="github_pat_… atau ghp_…"
        />
        <small>
          <ShieldCheck size={11} /> Token hanya hidup di memori tab ini dan
          hilang saat halaman ditutup. Gunakan token fine-grained dengan izin
          <b> Contents: read &amp; write</b> pada repositori tujuan; OAuth
          meminta cakupan <code>repo</code>.
        </small>
      </label>
      <label className="github-field">
        Repositori
        <input
          value={repo}
          disabled={busy}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="nama-akun/nama-repo"
          spellCheck={false}
        />
      </label>
      <div className="github-grid">
        <label className="github-field">
          Cabang
          <input
            value={branch}
            disabled={busy}
            onChange={(e) => setBranch(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="github-field">
          Pesan commit
          <input
            value={message}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
      </div>
      <p className="integration-note">
        {selection.files.length} file teks siap dikirim
        {selection.skipped > 0
          ? ` · ${selection.skipped} dilewati (biner/.env/terlalu besar)`
          : ""}
        . Batas 200 file dan 4 MB per push.
      </p>
      <button
        type="button"
        className="button button-dark full-width"
        onClick={() => void submit()}
        disabled={!canPush}
      >
        {busy ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <Github size={14} />
        )}
        {busy ? "Mengirim ke GitHub…" : "Push ke GitHub"}
      </button>
      {error && (
        <p className="github-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="github-result" role="status">
          <b>Push berhasil.</b> {result.files} file dikirim
          {result.skipped > 0 ? `, ${result.skipped} dilewati` : ""}
          {result.createdBranch ? `; cabang ${branch} dibuat` : ""}.
          <a href={result.url} target="_blank" rel="noreferrer">
            <ExternalLink size={11} /> Commit {result.commit.slice(0, 7)}
          </a>
        </div>
      )}
      {onExport && (
        <button
          type="button"
          className="button button-outline full-width"
          onClick={onExport}
        >
          <Download size={14} />
          Atau unduh kode ZIP
        </button>
      )}
    </div>
  );
}
