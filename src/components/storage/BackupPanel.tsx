import { useRef, useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { useStore } from "../../lib/store";
import { scopeFor } from "../../lib/cloud/types";
import {
  exportAllProjectPhotos,
  saveProjectPhotos,
} from "../../services/project-photos";
import {
  BACKUP_VERSION,
  backupReport,
  buildBackup,
  readBackup,
  restoreName,
  type Backup,
} from "../../lib/dashboard/backup";
import "./backup.css";

/** `piwuapp-cadangan-2026-10-16.json` */
export function backupFileName(now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return `piwuapp-cadangan-${date}.json`;
}

/**
 * The safety net for work that starts in this browser: one file with every
 * project, its history, and the photos stored for them.
 *
 * It lives in the storage dialog rather than on the dashboard because that is
 * where "my data lives here" is explained, and it carries its own confirmation
 * step: a restore is only ever started after the file has been read and its
 * contents named.
 */
export default function BackupPanel({ onDone }: { onDone?: () => void }) {
  const store = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState<
    { backup: Backup; skipped: number } | undefined
  >(undefined);
  const [note, setNote] = useState("");
  const demo = scopeFor(store.user) === "demo";

  async function download() {
    setBusy(true);
    setNote("");
    try {
      const account = scopeFor(store.user);
      let photos: ReturnType<typeof buildBackup>["photos"] = {};
      try {
        // Photos are a bonus: a browser that refuses IndexedDB still gets a
        // backup of the projects, and the note says what was left out.
        photos = await exportAllProjectPhotos(account);
      } catch {
        photos = {};
        setNote("Foto tidak bisa dibaca dari penyimpanan browser ini.");
      }
      const backup = buildBackup(store.projects, photos);
      const text = JSON.stringify(backup);
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = backupFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Released on the next tick: Safari needs the URL alive while the
      // navigation starts.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const report = backupReport(backup);
      store.notify(
        `Cadangan diunduh: ${report.projects} project · ${report.photos} foto · ${Math.round(text.length / 1024)} KB.`,
      );
    } catch (error) {
      store.notify(
        error instanceof Error
          ? `Cadangan gagal dibuat: ${error.message}`
          : "Cadangan gagal dibuat.",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Restoring only ever adds: fresh ids, and no name is taken twice. */
  async function restore() {
    if (!pending) return;
    setRestoring(true);
    const scope = scopeFor(store.user);
    const taken = new Set(store.projects.map((project) => project.name));
    let photosSaved = 0;
    let photosDropped = 0;
    for (const project of pending.backup.projects) {
      const name = restoreName(project.name, taken);
      taken.add(name);
      const id = store.importProject(project, name);
      const photos = pending.backup.photos[project.id];
      if (!photos?.length) continue;
      try {
        const result = await saveProjectPhotos(scope, id, photos);
        photosSaved += result.saved;
        photosDropped += result.dropped.length;
      } catch {
        photosDropped += photos.length;
      }
    }
    const parts = [
      `${pending.backup.projects.length} project ditambahkan`,
      photosSaved ? `${photosSaved} foto dipulihkan` : "",
      photosDropped
        ? `${photosDropped} foto tidak masuk (batas 12 per project / 16 MB)`
        : "",
      pending.skipped ? `${pending.skipped} entri dilewati` : "",
    ].filter(Boolean);
    store.notify(`${parts.join(" · ")}.`);
    setRestoring(false);
    setPending(undefined);
    setNote("Pemulihan selesai. Project baru ada di daftar project Anda.");
    onDone?.();
  }

  const report = pending ? backupReport(pending.backup) : null;
  return (
    <div className="storage-backup">
      <p className="storage-backup-intro">
        Cadangan menyalin semua project, riwayatnya, dan foto yang tersimpan di
        browser ini ke satu berkas <code>.json</code>. Simpan di tempat aman
        seperti berkas biasa — tidak ada yang dikirim ke mana pun.
      </p>
      <div className="storage-backup-actions">
        <button
          className="button button-dark"
          disabled={busy || demo || !store.projects.length}
          onClick={() => void download()}
        >
          <Download size={14} />
          {busy ? "Menyiapkan…" : "Unduh semua project"}
        </button>
        <button
          className="button button-outline"
          disabled={demo || restoring}
          onClick={() => input.current?.click()}
        >
          <Upload size={14} /> Pulihkan dari berkas
        </button>
      </div>
      <p className="storage-backup-note">
        Versi berkas: v{BACKUP_VERSION}. Pemuihan selalu menambah — project yang
        sudah ada tidak pernah ditimpa atau dihapus.
      </p>
      {pending && report && (
        <div
          className="storage-backup-confirm"
          role="group"
          aria-label="Konfirmasi pemulihan"
        >
          <b>
            Berkas memuat {report.projects} project ({report.files} file)
            {report.photos ? ` dan ${report.photos} foto` : ""}.
          </b>
          <p>
            Nama yang sudah dipakai akan muncul sebagai &ldquo;nama
            (pulih)&rdquo;.
            {pending.skipped
              ? ` ${pending.skipped} entri dilewati karena isinya tidak terbaca atau terlalu besar.`
              : ""}
          </p>
          <div className="storage-backup-actions">
            <button
              className="button button-outline"
              disabled={restoring}
              onClick={() => setPending(undefined)}
            >
              Batal
            </button>
            <button
              className="button button-dark"
              disabled={restoring}
              onClick={() => void restore()}
            >
              {restoring
                ? "Memulihkan…"
                : `Tambahkan ${report.projects} project`}
            </button>
          </div>
        </div>
      )}
      {note && (
        <p className="storage-backup-warn">
          <AlertTriangle size={12} /> {note}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label="Berkas cadangan PiwuApp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Let the same file be picked again after a failure.
          event.target.value = "";
          if (!file) return;
          void file.text().then((text) => {
            const read = readBackup(text, file.size);
            if (!read.ok) {
              setPending(undefined);
              setNote(read.error);
              return;
            }
            setNote("");
            setPending({ backup: read.backup, skipped: read.skipped });
          });
        }}
      />
    </div>
  );
}
