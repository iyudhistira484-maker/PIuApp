import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Database,
  Download,
  Upload,
  Save,
  RefreshCw,
} from "lucide-react";
import { APIError } from "../services/api";
import { dataRepository } from "../lib/data/repository";
import type { DataRepository } from "../lib/data/repository";
import {
  emptyDataset,
  validateDataset,
  serializeDataset,
  importDataset,
  columnSchema,
} from "../lib/data/schema";
import type { Dataset, DatasetMeta, DataColumn } from "../lib/data/schema";
import { saveDraft, dropDraft, listDrafts } from "../lib/data/drafts";
import type { AccessRole } from "../lib/cloud/types";
import AppApiPanel from "./AppApiPanel";
import "./data.css";
export default function CloudDataPanel({
  projectId,
  account,
  role,
  repository,
}: {
  projectId: string;
  account: string;
  role: AccessRole;
  repository?: DataRepository;
}) {
  const repo = useMemo(
    () => repository || dataRepository(projectId),
    [projectId, repository],
  );
  const [tables, setTables] = useState<DatasetMeta[]>([]),
    [draft, setDraft] = useState<Dataset | null>(null),
    [local, setLocal] = useState<Dataset[]>([]),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false),
    [cacheError, setCacheError] = useState("");
  const [colKey, setColKey] = useState(""),
    [colLabel, setColLabel] = useState(""),
    [colType, setColType] = useState<DataColumn["type"]>("text");
  const alive = useRef(true),
    upload = useRef<HTMLInputElement>(null);
  const canEdit = role === "Owner" || role === "Editor";
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void (async () => {
      try {
        let drafts: Dataset[] = [];
        try {
          drafts = await listDrafts(account, projectId);
        } catch {
          if (alive.current && !cancelled)
            setCacheError(
              "Draft lokal tidak dapat dibaca. Unduh JSON sebelum meninggalkan panel.",
            );
        }
        if (!alive.current || cancelled) return;
        setLocal(drafts);
        if (drafts[0]) {
          setDraft(drafts[0]);
          setDirty(true);
          setNotice(
            "Draft dari perangkat ini dipulihkan; belum disimpan ke cloud.",
          );
        }
        const rows = await repo.list();
        if (!alive.current || cancelled) return;
        setTables(rows);
        if (!drafts.length && rows[0]) {
          const first = await repo.get(rows[0].id);
          if (alive.current && !cancelled) setDraft(first);
        }
      } catch (e) {
        if (alive.current && !cancelled)
          setError(e instanceof Error ? e.message : "Data tidak dapat dimuat.");
      } finally {
        if (alive.current && !cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [repo, account, projectId]);
  useEffect(() => {
    if (!draft || !dirty) return;
    const value = draft;
    let cancelled = false;
    void saveDraft(account, projectId, value)
      .then(() => {
        if (alive.current && !cancelled) {
          setCacheError("");
          setLocal((old) => [value, ...old.filter((d) => d.id !== value.id)]);
        }
      })
      .catch(() => {
        if (alive.current && !cancelled)
          setCacheError(
            "Draft belum tersimpan di perangkat (ukuran, format, atau storage bermasalah). Unduh JSON sebelum keluar.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [draft, dirty, account, projectId]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (busy) return;
      void repo
        .list()
        .then((rows) => {
          if (alive.current) setTables(rows);
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [repo, busy]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "Operasi data gagal.");
        if (
          e instanceof APIError &&
          ["DATA_CONFLICT", "DATA_NOT_FOUND"].includes(e.code)
        )
          setConflict(true);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function edit(next: Dataset) {
    if (!canEdit || busy) return;
    setDraft(next);
    setDirty(true);
    setNotice("");
  }
  async function preserveCurrent() {
    if (draft && dirty) {
      await saveDraft(account, projectId, draft);
      const all = await listDrafts(account, projectId);
      if (alive.current) setLocal(all);
    }
  }
  async function open(id: string) {
    await run(async () => {
      await preserveCurrent();
      const cached = (await listDrafts(account, projectId)).find(
        (d) => d.id === id,
      );
      const next = cached || (await repo.get(id));
      if (!alive.current) return;
      setDraft(next);
      setDirty(Boolean(cached));
      setConflict(false);
      setNotice(
        cached ? "Draft lokal dipulihkan, belum disimpan ke cloud." : "",
      );
    });
  }
  async function save(copy = false) {
    if (!draft || !canEdit) return;
    await run(async () => {
      const input = validateDataset(
        copy
          ? {
              ...draft,
              id: crypto.randomUUID(),
              revision: 0,
              name: (draft.name + " (salinan)").slice(0, 80),
            }
          : draft,
      );
      const saved = await repo.save(input);
      if (!alive.current) return;
      setDraft(saved);
      setDirty(false);
      setConflict(false);
      setNotice("Tersimpan di cloud · revisi " + saved.revision);
      setTables((old) => [saved, ...old.filter((t) => t.id !== saved.id)]);
      try {
        await dropDraft(account, projectId, input.id);
        if (copy) await dropDraft(account, projectId, draft.id);
        setLocal((old) =>
          old.filter((d) => d.id !== draft.id && d.id !== input.id),
        );
      } catch {
        setCacheError(
          "Cloud tersimpan, tetapi salinan draft lokal belum dapat dibersihkan.",
        );
      }
    });
  }
  function exportJSON() {
    if (!draft) return;
    const url = URL.createObjectURL(
      new Blob([serializeDataset(draft)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = draft.name.replace(/[^a-z0-9_-]/gi, "-") + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const options = [
    ...tables,
    ...local.filter((d) => !tables.some((t) => t.id === d.id)),
    ...(draft &&
    !tables.some((t) => t.id === draft.id) &&
    !local.some((t) => t.id === draft.id)
      ? [draft]
      : []),
  ];
  const stale = Boolean(
    draft &&
    tables.find((t) => t.id === draft.id && t.revision > draft.revision),
  );
  return (
    <section className="database-panel cloud-data" aria-busy={busy}>
      <div className="tool-panel-title">
        <Database size={20} />
        <div>
          <h2>Tabel data cloud</h2>
          <p>Dataset privat project · {role} · simpan eksplisit</p>
        </div>
        <button
          className="ws-button"
          disabled={busy || !canEdit || options.length >= 20}
          onClick={() =>
            void run(async () => {
              await preserveCurrent();
              setDraft(emptyDataset());
              setDirty(true);
              setConflict(false);
              setNotice("Tabel baru masih berupa draft lokal.");
            })
          }
        >
          <Plus size={13} />
          Buat tabel
        </button>
      </div>
      <div className="ws-notice">
        Data tersimpan di Supabase dan hanya dapat diakses anggota project. Ini
        bukan SQL console, tabel fisik per kolom, atau backend publik aplikasi
        hasil ekspor. Draft browser tidak terenkripsi; jangan masukkan secret.
      </div>
      {busy && <p role="status">Memuat atau menyimpan data…</p>}
      {error && (
        <div role="alert" className="data-error">
          {error}
          <button
            className="ws-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const rows = await repo.list();
                if (!alive.current) return;
                setTables(rows);
                if (!draft && rows[0]) {
                  const d = await repo.get(rows[0].id);
                  if (alive.current) setDraft(d);
                }
              })
            }
          >
            Coba lagi
          </button>
        </div>
      )}
      {cacheError && (
        <div role="alert" className="data-error">
          {cacheError}
        </div>
      )}
      {notice && (
        <p role="status" className="data-status">
          {notice}
        </p>
      )}
      {(conflict || stale) && (
        <div className="data-conflict" role="status">
          Ada versi cloud yang berbeda. Draft tidak ditimpa otomatis. Ekspor
          cadangan, muat ulang, atau simpan sebagai tabel baru.
          <button
            className="ws-button"
            disabled={busy || !canEdit}
            onClick={() => void save(true)}
          >
            Simpan sebagai tabel baru
          </button>
        </div>
      )}
      <div className="data-toolbar">
        <label>
          Tabel
          <select
            aria-label="Pilih tabel data"
            disabled={busy || !options.length}
            value={draft?.id || ""}
            onChange={(e) => void open(e.target.value)}
          >
            <option value="" disabled>
              Pilih tabel
            </option>
            {options.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
                {local.some((l) => l.id === t.id) ? " · draft" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ws-button"
          disabled={busy || !canEdit}
          onClick={() => upload.current?.click()}
        >
          <Upload size={13} />
          Impor JSON
        </button>
        <input
          ref={upload}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void run(async () => {
                if (file.size > 2500000)
                  throw new Error("File impor terlalu besar.");
                const imported = importDataset(await file.text());
                await preserveCurrent();
                if (!alive.current) return;
                setDraft(imported);
                setDirty(true);
                setConflict(false);
                setNotice(
                  "Impor membuat draft baru; belum mengubah data cloud.",
                );
              });
          }}
        />
        {draft && (
          <button className="ws-button" onClick={exportJSON}>
            <Download size={13} />
            Ekspor JSON
          </button>
        )}
      </div>
      {!draft && !busy && (
        <div className="ws-empty-text">
          Belum ada tabel.{" "}
          {canEdit
            ? "Buat tabel atau impor JSON untuk memulai."
            : "Minta Editor membuat tabel pertama."}
        </div>
      )}
      {draft && (
        <>
          <div className="data-toolbar">
            <label>
              Nama tabel
              <input
                aria-label="Nama tabel"
                maxLength={80}
                value={draft.name}
                disabled={busy || !canEdit}
                onChange={(e) => edit({ ...draft, name: e.target.value })}
              />
            </label>
            <span className="data-meta">
              {dirty ? "Draft · belum disimpan" : `Revisi ${draft.revision}`} ·{" "}
              {draft.rows.length}/1.000 baris
            </span>
            <button
              className="ws-button data-save"
              disabled={busy || !dirty || !canEdit}
              onClick={() => void save()}
            >
              <Save size={13} />
              Simpan ke cloud
            </button>
            <button
              className="ws-button"
              disabled={busy || !draft.revision}
              onClick={() => {
                if (
                  dirty &&
                  !confirm(
                    "Buang draft lokal dan ambil versi cloud? Ekspor JSON terlebih dahulu bila ingin menyimpannya.",
                  )
                )
                  return;
                void run(async () => {
                  const next = await repo.get(draft.id);
                  if (!alive.current) return;
                  setDraft(next);
                  setDirty(false);
                  setConflict(false);
                  setNotice("Versi cloud dimuat.");
                  await dropDraft(account, projectId, draft.id);
                  setLocal((old) => old.filter((t) => t.id !== draft.id));
                });
              }}
            >
              <RefreshCw size={13} />
              Muat ulang cloud
            </button>
          </div>
          <form
            className="data-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = columnSchema.safeParse({
                key: colKey,
                label: colLabel || colKey,
                type: colType,
              });
              if (
                !parsed.success ||
                draft.columns.some((c) => c.key === colKey)
              ) {
                setError(
                  "Kunci kolom harus unik, huruf kecil/angka/underscore, dimulai huruf; maksimal 40 karakter.",
                );
                return;
              }
              edit({ ...draft, columns: [...draft.columns, parsed.data] });
              setColKey("");
              setColLabel("");
              setError("");
            }}
          >
            <label>
              Kunci kolom
              <input
                value={colKey}
                onChange={(e) => setColKey(e.target.value)}
                placeholder="harga"
                disabled={busy || !canEdit}
              />
            </label>
            <label>
              Label kolom
              <input
                value={colLabel}
                onChange={(e) => setColLabel(e.target.value)}
                placeholder="Harga"
                maxLength={80}
                disabled={busy || !canEdit}
              />
            </label>
            <label>
              Tipe
              <select
                value={colType}
                onChange={(e) =>
                  setColType(e.target.value as DataColumn["type"])
                }
                disabled={busy || !canEdit}
              >
                <option value="text">Teks</option>
                <option value="number">Angka</option>
                <option value="boolean">Ya/tidak</option>
              </select>
            </label>
            <button
              className="ws-button"
              disabled={
                busy || !canEdit || draft.columns.length >= 32 || !colKey
              }
            >
              Tambah kolom
            </button>
            <button
              type="button"
              className="ws-button"
              disabled={busy || !canEdit || draft.rows.length >= 1000}
              onClick={() =>
                edit({
                  ...draft,
                  rows: [
                    ...draft.rows,
                    { id: crypto.randomUUID(), values: {} },
                  ],
                })
              }
            >
              <Plus size={13} />
              Tambah baris
            </button>
          </form>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Data tabel {draft.name}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {draft.columns.map((c) => (
                    <th scope="col" key={c.key}>
                      {c.label}
                      <small>
                        {c.type === "text"
                          ? "teks"
                          : c.type === "number"
                            ? "angka"
                            : "ya/tidak"}{" "}
                        · {c.key}
                      </small>
                      {canEdit && (
                        <button
                          className="ws-icon"
                          aria-label={"Hapus kolom " + c.label}
                          disabled={busy || draft.columns.length === 1}
                          onClick={() => {
                            if (
                              !confirm(
                                "Hapus kolom " +
                                  c.label +
                                  " beserta nilainya dari draft?",
                              )
                            )
                              return;
                            edit({
                              ...draft,
                              columns: draft.columns.filter(
                                (v) => v.key !== c.key,
                              ),
                              rows: draft.rows.map((r) => ({
                                ...r,
                                values: Object.fromEntries(
                                  Object.entries(r.values).filter(
                                    ([k]) => k !== c.key,
                                  ),
                                ),
                              })),
                            });
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </th>
                  ))}
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row, index) => (
                  <tr key={row.id}>
                    <th scope="row">{index + 1}</th>
                    {draft.columns.map((c) => {
                      const value = row.values[c.key];
                      const change = (
                        value: string | number | boolean | null,
                      ) =>
                        edit({
                          ...draft,
                          rows: draft.rows.map((r) =>
                            r.id === row.id
                              ? {
                                  ...r,
                                  values: { ...r.values, [c.key]: value },
                                }
                              : r,
                          ),
                        });
                      return (
                        <td key={c.key}>
                          {c.type === "boolean" ? (
                            <select
                              aria-label={c.label + " baris " + (index + 1)}
                              value={value == null ? "" : String(value)}
                              disabled={busy || !canEdit}
                              onChange={(e) =>
                                change(
                                  e.target.value === ""
                                    ? null
                                    : e.target.value === "true",
                                )
                              }
                            >
                              <option value="">Kosong</option>
                              <option value="true">Ya</option>
                              <option value="false">Tidak</option>
                            </select>
                          ) : (
                            <input
                              aria-label={c.label + " baris " + (index + 1)}
                              type={c.type === "number" ? "number" : "text"}
                              step="any"
                              maxLength={4000}
                              value={value == null ? "" : String(value)}
                              disabled={busy || !canEdit}
                              onChange={(e) =>
                                change(
                                  c.type === "number"
                                    ? e.target.value === ""
                                      ? null
                                      : Number(e.target.value)
                                    : e.target.value,
                                )
                              }
                            />
                          )}
                        </td>
                      );
                    })}
                    <td>
                      <button
                        className="ws-icon"
                        aria-label={"Hapus baris " + (index + 1)}
                        disabled={busy || !canEdit}
                        onClick={() =>
                          edit({
                            ...draft,
                            rows: draft.rows.filter((r) => r.id !== row.id),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!draft.rows.length && (
              <div className="ws-empty-text">
                Tabel kosong. Tambahkan baris pertama.
              </div>
            )}
          </div>
          <div className="data-toolbar">
            {dirty && (
              <button
                className="ws-button"
                disabled={busy}
                onClick={() => {
                  if (
                    !confirm(
                      "Buang draft lokal ini? Data yang sudah tersimpan di cloud tidak akan dihapus.",
                    )
                  )
                    return;
                  void run(async () => {
                    await dropDraft(account, projectId, draft.id);
                    setLocal((old) => old.filter((d) => d.id !== draft.id));
                    setDraft(null);
                    setDirty(false);
                  });
                }}
              >
                Buang draft lokal
              </button>
            )}
            {role === "Owner" && draft.revision > 0 && (
              <button
                className="ws-button"
                disabled={busy || dirty}
                onClick={() => {
                  if (
                    !confirm(
                      "Hapus tabel " +
                        draft.name +
                        " dari cloud secara permanen? Ekspor JSON untuk cadangan.",
                    )
                  )
                    return;
                  void run(async () => {
                    await repo.remove(draft.id, draft.revision);
                    if (!alive.current) return;
                    await dropDraft(account, projectId, draft.id);
                    setTables((old) => old.filter((t) => t.id !== draft.id));
                    setLocal((old) => old.filter((t) => t.id !== draft.id));
                    setDraft(null);
                    setDirty(false);
                    setNotice("Tabel dihapus dari cloud.");
                  });
                }}
              >
                Hapus tabel cloud
              </button>
            )}
            <small>
              20 tabel/project · 32 kolom/tabel · 2 MB/tabel. Perubahan hanya
              tersimpan di server setelah Anda memilih Simpan ke cloud.
            </small>
          </div>
        </>
      )}
      <AppApiPanel projectId={projectId} role={role} />
    </section>
  );
}
