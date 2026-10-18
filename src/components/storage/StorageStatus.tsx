import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Cloud,
  CloudUpload,
  CloudOff,
  HardDrive,
  RefreshCw,
  ArrowUpRight,
  AlertTriangle,
  Check,
  Upload,
  LoaderCircle,
  ShieldCheck,
  GitCompareArrows,
  Copy,
  Download,
  ArrowLeft,
} from "lucide-react";
import { useStorageHealth } from "../../lib/local-storage";
import { useStore } from "../../lib/store";
import { scopeFor } from "../../lib/cloud/types";
import { requestCloudSync } from "../../lib/cloud/sync";
import { Modal } from "../ui";
import BackupPanel from "./BackupPanel";
import "./storage.css";
export function StorageStatus({
  projectId,
  dark = false,
}: {
  projectId?: string;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const user = useStore((s) => s.user);
  const connection = useStore((s) => s.connection);
  const sync = useStore((s) => s.sync);
  const localError = useStorageHealth((s) => s.error);
  const local = scopeFor(user) === "demo";
  const entries = projectId
    ? [sync[projectId]].filter(Boolean)
    : Object.values(sync);
  const phase = localError
    ? "deviceError"
    : local
      ? "local"
      : entries.some((e) => e.phase === "conflict")
        ? "conflict"
        : connection.phase === "offline"
          ? "offline"
          : connection.phase === "error" ||
              entries.some((e) => e.phase === "error")
            ? "error"
            : connection.phase === "loading"
              ? "loading"
              : entries.some((e) => e.phase === "saving")
                ? "saving"
                : entries.some((e) => e.phase === "pending")
                  ? "pending"
                  : "synced";
  const Icon =
    phase === "local"
      ? HardDrive
      : phase === "synced"
        ? CloudUpload
        : phase === "offline"
          ? CloudOff
          : phase === "error" || phase === "conflict" || phase === "deviceError"
            ? AlertTriangle
            : phase === "pending"
              ? Cloud
              : LoaderCircle;
  const label = {
    deviceError: "Perangkat belum menyimpan",
    local: "Tersimpan di perangkat ini",
    synced: "Tersinkron ke cloud",
    pending: "Menunggu sinkronisasi",
    saving: "Menyimpan ke cloud…",
    loading: "Memuat project cloud…",
    offline: "Offline · salinan lokal",
    error: "Sinkronisasi perlu perhatian",
    conflict: "Konflik versi",
  }[phase];
  return (
    <>
      <button
        className={`storage-status ${dark ? "dark" : ""} ${phase}`}
        onClick={() => setOpen(true)}
        title="Lihat status penyimpanan"
        aria-label={"Penyimpanan: " + label}
      >
        <Icon
          size={13}
          className={phase === "saving" || phase === "loading" ? "spin" : ""}
        />
        <span>{label}</span>
      </button>
      {open && <StorageDialog onClose={() => setOpen(false)} />}
    </>
  );
}
export function CloudSyncBanner() {
  const [open, setOpen] = useState(false);
  const state = useStore();
  const storageError = useStorageHealth((s) => s.error);
  if (storageError)
    return (
      <>
        <div className="cloud-banner warning" role="alert">
          <AlertTriangle size={18} />
          <div>
            <b>Penyimpanan perangkat memerlukan perhatian</b>
            <p>{storageError}</p>
          </div>
          <button onClick={() => setOpen(true)}>
            Cadangkan
            <Download size={13} />
          </button>
        </div>
        {open && <StorageDialog onClose={() => setOpen(false)} />}
      </>
    );
  if (scopeFor(state.user) === "demo") return null;
  const conflicts = Object.values(state.sync).filter(
    (s) => s.phase === "conflict",
  ).length;
  const status = state.connection.phase;
  if (!conflicts && status === "ready") return null;
  return (
    <>
      <div
        className={
          "cloud-banner " + (conflicts || status === "error" ? "warning" : "")
        }
        role="status"
      >
        {status === "loading" ? (
          <LoaderCircle className="spin" size={17} />
        ) : conflicts ? (
          <GitCompareArrows size={18} />
        ) : status === "offline" ? (
          <CloudOff size={18} />
        ) : (
          <AlertTriangle size={18} />
        )}
        <div>
          <b>
            {conflicts
              ? `${conflicts} project memiliki versi yang berbeda`
              : status === "loading"
                ? "Menyiapkan workspace cloud Anda"
                : status === "offline"
                  ? "Anda sedang offline"
                  : "Project tersimpan lokal, belum terkonfirmasi di cloud"}
          </b>
          <p>
            {conflicts
              ? "Periksa perubahan sebelum melanjutkan. Tidak ada versi yang ditimpa otomatis."
              : state.connection.error ||
                "Mengambil project yang Anda miliki dan yang dibagikan kepada Anda."}
          </p>
        </div>
        <button onClick={() => setOpen(true)}>
          {status === "loading" ? "Detail" : "Periksa"}
          <ArrowUpRight size={13} />
        </button>
      </div>
      {open && <StorageDialog onClose={() => setOpen(false)} />}
    </>
  );
}
export function StorageDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const storageError = useStorageHealth((s) => s.error);
  const local = scopeFor(s.user) === "demo";
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<"status" | "import" | "backup">("status");
  const [conflictId, setConflictId] = useState("");
  const [discard, setDiscard] = useState(false);
  const conflict = s.sync[conflictId];
  const localProject = s.projects.find((p) => p.id === conflictId);
  const demos = s.workspaces.demo?.projects || [];
  const download = (id: string) => {
    const p = s.projects.find((p) => p.id === id);
    if (!p) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = p.name.replace(/[^a-zA-Z0-9_-]/g, "-") + "-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const phaseText = {
    synced: "Tersinkron",
    pending: "Menunggu",
    saving: "Menyimpan…",
    conflict: "Konflik",
    error: "Belum tersinkron",
  };
  const closeConflict = () => {
    setConflictId("");
    setDiscard(false);
  };
  return (
    <Modal
      title={conflictId ? "Tinjau dua versi" : "Penyimpanan workspace"}
      onClose={onClose}
      wide={Boolean(conflictId)}
    >
      <div className="storage-dialog">
        {storageError && (
          <p className="storage-error" role="alert">
            {storageError}
          </p>
        )}
        {conflictId && localProject && conflict ? (
          <>
            <button className="storage-back" onClick={closeConflict}>
              <ArrowLeft size={13} />
              Kembali ke status
            </button>
            <div className="storage-intro">
              <span className="storage-intro-icon warning">
                <GitCompareArrows size={24} />
              </span>
              <div>
                <h3>Perubahan Anda tetap aman.</h3>
                <p>
                  Project “{localProject.name}” tidak disimpan otomatis karena
                  versi cloud berbeda. Pilih bagaimana ingin melanjutkan.
                </p>
              </div>
            </div>
            <div className="conflict-grid">
              <article>
                <span>DI PERANGKAT INI</span>
                <h4>{localProject.name}</h4>
                <p>
                  {Object.keys(localProject.files).length} file ·{" "}
                  {localProject.messages.length} pesan
                </p>
                <small>
                  Diedit{" "}
                  {new Date(localProject.updatedAt).toLocaleString("id-ID")}
                </small>
                <button
                  className="text-link"
                  onClick={() => download(conflictId)}
                >
                  <Download size={13} />
                  Unduh cadangan JSON
                </button>
              </article>
              <article>
                <span>DI CLOUD</span>
                <h4>
                  {conflict.remote?.project.name ||
                    (conflict.remote === null
                      ? "Tidak tersedia"
                      : "Belum dimuat")}
                </h4>
                <p>
                  {conflict.remote
                    ? `${Object.keys(conflict.remote.project.files).length} file · Revisi ${conflict.remote.revision}`
                    : conflict.remote === null
                      ? "Project dihapus atau akses Anda telah dicabut."
                      : "Coba muat ulang status cloud."}
                </p>
                {conflict.remote && (
                  <small>
                    Diedit{" "}
                    {new Date(conflict.remote.updatedAt).toLocaleString(
                      "id-ID",
                    )}
                  </small>
                )}
              </article>
            </div>
            {conflict.remote && (
              <div className="conflict-files">
                <b>File dengan konten berbeda</b>
                {Array.from(
                  new Set([
                    ...Object.keys(localProject.files),
                    ...Object.keys(conflict.remote.project.files),
                  ]),
                )
                  .filter(
                    (p) =>
                      localProject.files[p] !==
                      conflict.remote!.project.files[p],
                  )
                  .map((p) => (
                    <code key={p}>{p}</code>
                  ))}
                <small>
                  Perbedaan juga dapat mencakup nama, pesan, rencana, komentar,
                  dan riwayat.
                </small>
              </div>
            )}
            <button
              className="button button-dark full-width"
              disabled={conflict.remote === undefined}
              onClick={() => {
                s.resolveConflict(conflictId, "fork");
                closeConflict();
                s.notify(
                  "Edit lokal disimpan sebagai project baru. Versi cloud asli tidak ditimpa.",
                );
                requestCloudSync();
              }}
            >
              <Copy size={15} />
              Simpan keduanya · buat salinan pribadi
            </button>
            <label className="discard-confirm">
              <input
                type="checkbox"
                checked={discard}
                onChange={(e) => setDiscard(e.target.checked)}
              />
              Saya memahami versi lokal ini akan diganti atau dihapus dari
              daftar aktif.
            </label>
            <button
              className="button button-outline full-width"
              disabled={!discard || conflict.remote === undefined}
              onClick={() => {
                s.resolveConflict(conflictId, "cloud");
                closeConflict();
                s.notify("Workspace menggunakan versi cloud yang dipilih.");
              }}
            >
              <Cloud size={15} />
              {conflict.remote === null
                ? "Hapus salinan lokal dari daftar"
                : "Gunakan versi cloud"}
            </button>
            {conflict.remote === undefined && (
              <button className="text-link" onClick={requestCloudSync}>
                <RefreshCw size={13} />
                Muat ulang versi cloud
              </button>
            )}
          </>
        ) : (
          <>
            <div className="storage-intro">
              <span className="storage-intro-icon">
                {local ? <HardDrive size={24} /> : <Cloud size={24} />}
              </span>
              <div>
                <h3>
                  {local
                    ? "Ruang Anda, di perangkat ini."
                    : "Satu workspace, lintas perangkat."}
                </h3>
                <p>
                  {local
                    ? "Mode demo tidak mengunggah file ke server. Project Anda tetap tersedia di browser ini."
                    : `Akun ${s.user?.email}. Hanya project milik akun ini dan project yang dibagikan kepada Anda yang dimuat.`}
                </p>
              </div>
            </div>
            <div className="storage-facts">
              <span>
                <ShieldCheck size={14} />
                {local
                  ? "Demo terpisah dari akun cloud"
                  : "Akses cloud diperiksa oleh Supabase RLS"}
              </span>
              <span>
                <HardDrive size={14} />
                Salinan lokal bukan penyimpanan terenkripsi
              </span>
            </div>
            {local ? (
              <>
                {storageError &&
                  s.projects.map((p) => (
                    <button
                      key={p.id}
                      className="button button-outline full-width"
                      style={{ marginTop: 10 }}
                      onClick={() => download(p.id)}
                    >
                      <Download size={14} />
                      Cadangkan {p.name}
                    </button>
                  ))}
                <div className="storage-local-note">
                  <b>Ingin melanjutkan di perangkat lain?</b>
                  <p>
                    Masuk ke akun Supabase, lalu pilih project demo yang ingin
                    disalin ke cloud. Tidak ada unggahan otomatis dari workspace
                    demo.
                  </p>
                </div>
                <Link
                  to="/login"
                  className="button button-dark full-width"
                  onClick={onClose}
                >
                  Masuk ke akun <ArrowUpRight size={15} />
                </Link>
              </>
            ) : (
              <>
                <div className="storage-tabs">
                  <button
                    className={tab === "status" ? "active" : ""}
                    onClick={() => setTab("status")}
                  >
                    Status sinkronisasi
                  </button>
                  <button
                    className={tab === "import" ? "active" : ""}
                    onClick={() => setTab("import")}
                  >
                    Impor dari demo <span>{demos.length}</span>
                  </button>
                  <button
                    className={tab === "backup" ? "active" : ""}
                    onClick={() => setTab("backup")}
                  >
                    Cadangan
                  </button>
                </div>
                {tab === "backup" ? (
                  <BackupPanel />
                ) : tab === "status" ? (
                  <>
                    {s.connection.error && (
                      <p className="storage-error" role="alert">
                        {s.connection.error}
                      </p>
                    )}
                    <div className="storage-project-list">
                      {s.projects.length ? (
                        s.projects.map((p) => {
                          const entry = s.sync[p.id];
                          return (
                            <div className="storage-project" key={p.id}>
                              <span
                                className={
                                  "storage-project-dot " +
                                  (entry?.phase || "pending")
                                }
                              />
                              <div>
                                <b>{p.name}</b>
                                <small>
                                  {entry?.role || "Owner"} ·{" "}
                                  {entry?.revision
                                    ? `Revisi ${entry.revision}`
                                    : "Belum pernah diunggah"}
                                </small>
                              </div>
                              <span
                                className={
                                  "storage-phase " + (entry?.phase || "pending")
                                }
                              >
                                {phaseText[entry?.phase || "pending"]}
                              </span>
                              {entry?.phase === "conflict" ? (
                                <button
                                  aria-label={"Tinjau konflik " + p.name}
                                  className="icon-button"
                                  onClick={() => {
                                    setConflictId(p.id);
                                    setDiscard(false);
                                  }}
                                >
                                  <GitCompareArrows size={17} />
                                </button>
                              ) : (
                                <button
                                  aria-label={"Cadangkan " + p.name}
                                  className="icon-button"
                                  onClick={() => download(p.id)}
                                >
                                  <Download size={15} />
                                </button>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="storage-empty">
                          <Cloud size={24} />
                          <p>
                            {s.connection.phase === "loading"
                              ? "Memuat daftar project…"
                              : "Belum ada project di workspace akun ini."}
                          </p>
                        </div>
                      )}
                    </div>
                    {Object.keys(s.deleted).length > 0 && (
                      <p className="storage-error">
                        {Object.keys(s.deleted).length} penghapusan sedang
                        menunggu konfirmasi cloud.
                      </p>
                    )}
                    <button
                      className="button button-outline full-width"
                      disabled={s.connection.phase === "loading"}
                      onClick={requestCloudSync}
                    >
                      <RefreshCw
                        size={14}
                        className={
                          s.connection.phase === "loading" ? "spin" : ""
                        }
                      />
                      Sinkronkan sekarang
                    </button>
                    <small className="storage-footnote">
                      Pemeriksaan otomatis setiap 60 detik dan saat tab kembali
                      aktif. Prompt pribadi dan tabel demo masih lokal; bukan
                      kolaborasi real-time.
                    </small>
                  </>
                ) : (
                  <>
                    <p className="storage-import-note">
                      Pilih project yang akan disalin ke akun{" "}
                      <b>{s.user?.email}</b>. Project demo asli tidak dihapus,
                      dan salinan mendapatkan ID baru.
                    </p>
                    <div className="storage-project-list">
                      {demos.length ? (
                        demos.map((p) => (
                          <label className="import-project" key={p.id}>
                            <input
                              type="checkbox"
                              checked={selected.includes(p.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, p.id]
                                    : selected.filter((x) => x !== p.id),
                                )
                              }
                            />
                            <div>
                              <b>{p.name}</b>
                              <small>
                                {Object.keys(p.files).length} file ·{" "}
                                {new Date(p.updatedAt).toLocaleDateString(
                                  "id-ID",
                                )}
                              </small>
                            </div>
                            <HardDrive size={16} />
                          </label>
                        ))
                      ) : (
                        <div className="storage-empty">
                          <HardDrive size={24} />
                          <p>
                            Tidak ada project demo untuk diimpor dari browser
                            ini.
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="storage-import-warning">
                      <AlertTriangle size={14} />
                      Tinjau file sebelum mengunggah. Jangan sertakan kata
                      sandi, secret, atau data pribadi.
                    </div>
                    <button
                      className="button button-dark full-width"
                      disabled={!selected.length}
                      onClick={() => {
                        const count = s.importDemoProjects(selected);
                        setSelected([]);
                        setTab("status");
                        s.notify(
                          `${count} salinan dibuat. Status unggahan dapat dipantau di sini.`,
                        );
                        requestCloudSync();
                      }}
                    >
                      <Upload size={14} />
                      Salin {selected.length || ""} project ke akun
                    </button>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
