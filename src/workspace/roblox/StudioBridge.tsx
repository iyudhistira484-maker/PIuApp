import { useEffect, useState } from "react";
import { projectApi } from "../../services/api";
import type { Project } from "../../lib/types";
import { useStore } from "../../lib/store";
import {
  STUDIO_PLUGIN,
  snapshotSchema,
  buildBundle,
  validateBundle,
  type StudioSnapshot,
  type StudioBundle,
  type StudioNode,
  editableClasses,
} from "../../../shared/studio.mjs";
import { downloadText } from "../../lib/download";
import { SCENE_PATH, sceneSchema } from "../../lib/roblox/scene";
import * as THREE from "three";
const BASE = "studio.snapshot.json",
  DESIRED = "studio.desired.json";
export default function StudioBridge({
  project,
  readOnly,
  onOpenFile,
}: {
  project: Project;
  readOnly: boolean;
  onOpenFile: (path: string) => void;
}) {
  const [baseline, setBaseline] = useState<StudioSnapshot | null>(null),
    [snapshotInfo, setSnapshotInfo] = useState<{
      nodes: number;
      updatedAt: string;
    } | null>(null),
    [bundle, setBundle] = useState<StudioBundle | null>(null),
    [credential, setCredential] = useState(""),
    [status, setStatus] = useState("Belum memeriksa koneksi Studio."),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [name, setName] = useState("Objek baru"),
    [cls, setCls] = useState("Folder"),
    [confirmed, setConfirmed] = useState(false);
  const noteSnapshot = (d: any) => {
    const parsed = snapshotSchema.safeParse(d?.snapshot);
    setSnapshotInfo({
      nodes: parsed.success ? parsed.data.nodes.length : 0,
      updatedAt: String(d?.updatedAt || ""),
    });
    if (parsed.success) setBaseline(parsed.data);
  };
  useEffect(() => {
    let dead = false;
    // Ask even before an import: the panel must say whether the AI currently
    // has a Studio snapshot to read, instead of leaving that invisible.
    void projectApi(project.id, "studio")
      .then((d) => {
        if (!dead) noteSnapshot(d);
      })
      .catch(() => {
        if (!dead && project.files[DESIRED])
          setStatus("Muat koneksi Studio untuk meninjau ulang snapshot dasar.");
      });
    return () => {
      dead = true;
    };
  }, [project.id]);
  let desired: StudioSnapshot | null = null;
  try {
    desired = snapshotSchema.parse(JSON.parse(project.files[DESIRED] || ""));
  } catch {}
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operasi gagal.");
    } finally {
      setBusy(false);
    }
  };
  const apply = (files: Record<string, string>, label: string) => {
    if (readOnly) return;
    if (
      Object.keys({ ...project.files, ...files }).length > 200 ||
      Object.values(files).some((v) => v.length > 240000)
    )
      throw Error(
        "Snapshot melampaui batas 200 file/240 KB per file. Kurangi isi place sebelum impor.",
      );
    useStore.getState().applyFiles(project.id, files, label);
    setBundle(null);
    setConfirmed(false);
  };
  const saveDesired = (s: StudioSnapshot) => {
    snapshotSchema.parse(s);
    apply({ [DESIRED]: JSON.stringify(s, null, 2) }, "Ubah Explorer Roblox");
  };
  const importSnapshot = (data: StudioSnapshot) => {
    const snap = snapshotSchema.parse(data);
    const meta = { ...snap, nodes: snap.nodes.map(({ source, ...n }) => n) };
    const files: Record<string, string> = {
      [BASE]: JSON.stringify(meta, null, 2),
      [DESIRED]: JSON.stringify(meta, null, 2),
    };
    for (const n of snap.nodes)
      if (n.scriptPath && n.source !== undefined)
        files[n.scriptPath] = n.source;
    apply(files, "Impor snapshot Roblox Studio");
    setBaseline(snap);
    setStatus(
      `${snap.nodes.length} instance diterima dari Studio. File lama tidak dihapus otomatis.`,
    );
  };
  const check = async () => {
    const d = await projectApi(project.id, "studio");
    setStatus(
      d.connected
        ? `Bridge aktif · ${d.state}${d.receipt ? " · receipt " + (d.receipt.ok ? "berhasil" : "gagal/periksa Studio") : ""}`
        : "Bridge belum aktif atau kedaluwarsa.",
    );
    if (d.snapshot) noteSnapshot(d);
    return d;
  };
  const build = () => {
    if (!baseline || !desired)
      throw Error("Muat snapshot dari Studio dan impor terlebih dahulu.");
    const b = buildBundle(baseline, desired, project.files);
    validateBundle(baseline, b);
    setBundle(b);
    setConfirmed(false);
    return b;
  };
  const node = desired?.nodes.find((n) => n.id === selected);
  function tree(parent: string | null): React.ReactNode {
    return desired?.nodes
      .filter((n) => n.parentId === parent || (!n.parentId && !parent))
      .map((n) => (
        <div key={n.id} style={{ marginLeft: n.parentId ? 14 : 0 }}>
          <button
            onClick={() => {
              setSelected(n.id);
              setName(n.name);
            }}
            aria-pressed={selected === n.id}
          >
            <span>{n.name}</span>
            <small>{n.className}</small>
          </button>
          {tree(n.id)}
        </div>
      ));
  }
  function importGeometry() {
    if (!desired) throw Error("Impor snapshot Studio dahulu.");
    const root = desired.nodes.find(
      (n) => !n.parentId && n.className === "Workspace",
    );
    if (!root) throw Error("Workspace tidak ada dalam snapshot.");
    const scene = sceneSchema.parse(
      JSON.parse(project.files[SCENE_PATH] || ""),
    );
    if (scene.objects.some((o) => o.kind === "mesh"))
      throw Error(
        "Scene mengandung mesh kustom. Ekspor OBJ dan impor aset melalui Studio; transfer mesh mentah belum didukung bridge.",
      );
    const nodes = desired.nodes.filter((n) => !n.id.startsWith("builder:"));
    const world = (id: string): THREE.Matrix4 => {
      const o = scene.objects.find((n) => n.id === id)!;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...o.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            ...(o.rotation.map((v) => (v * Math.PI) / 180) as [
              number,
              number,
              number,
            ]),
          ),
        ),
        new THREE.Vector3(1, 1, 1),
      );
      return o.parent ? world(o.parent).multiply(matrix) : matrix;
    };
    for (const o of scene.objects) {
      const m = world(o.id),
        p = new THREE.Vector3(),
        q = new THREE.Quaternion(),
        scale = new THREE.Vector3();
      m.decompose(p, q, scale);
      const rot = new THREE.Euler().setFromQuaternion(q, "XYZ");
      nodes.push({
        id: "builder:" + o.id,
        parentId: o.parent ? "builder:" + o.parent : root.id,
        name: o.name,
        className: o.kind === "model" ? "Model" : "Part",
        properties:
          o.kind === "model"
            ? {}
            : {
                position: p.toArray() as [number, number, number],
                rotation: [rot.x, rot.y, rot.z].map(
                  (v) => (v * 180) / Math.PI,
                ) as [number, number, number],
                size: o.size,
                color: o.color,
                anchored: o.anchored,
                shape:
                  o.kind === "sphere"
                    ? "Ball"
                    : o.kind === "cylinder"
                      ? "Cylinder"
                      : "Block",
              },
      });
    }
    saveDesired({ ...desired, nodes });
    setStatus(
      "Geometri ditambahkan ke draft Explorer. Tinjau bundle sebelum mengirim.",
    );
  }
  return (
    <div className="rb-bridge">
      <h2>Explorer Studio, terhubung.</h2>
      <p>
        Setiap tugas AI di project Roblox ini otomatis membaca snapshot terbaru
        dari Studio — pohon instance dan source Luau yang dapat dibaca — tanpa
        perlu menekan Impor lebih dulu. Snapshot hanya terkirim saat Anda
        menekan <strong>Kirim snapshot</strong> di plugin, dan AI tidak pernah
        mengubah Studio langsung: perubahan tetap lewat bundle yang Anda tinjau
        lalu terapkan sendiri.
      </p>
      <p role="status">
        {snapshotInfo === null
          ? "Memeriksa snapshot Studio…"
          : snapshotInfo.nodes
            ? `Konteks AI: ${snapshotInfo.nodes} instance dari snapshot Studio terakhir${
                snapshotInfo.updatedAt
                  ? ` (${new Date(snapshotInfo.updatedAt).toLocaleString(
                      "id-ID",
                      { dateStyle: "medium", timeStyle: "short" },
                    )})`
                  : ""
              }. Source script yang bisa dibaca ikut dikirim pada setiap tugas AI.`
            : "Belum ada snapshot Studio. AI baru bisa membaca source setelah Anda klik Kirim snapshot di plugin."}
      </p>
      <a
        className="rb-primary"
        href="/plugins/PiwuStudio.rbxmx"
        download="PiwuStudio.rbxmx"
      >
        Unduh plugin PiwuApp .rbxmx · v{STUDIO_PLUGIN.version}
      </a>
      <ol className="rb-steps">
        <li>
          Simpan <code>PiwuStudio.rbxmx</code> ke folder Plugins Studio —
          Windows <code>%LOCALAPPDATA%\Roblox\Plugins</code>, macOS{" "}
          <code>~/Documents/Roblox/Plugins</code>. Buat foldernya bila belum
          ada.
        </li>
        <li>
          Buka place ini di Studio, lalu <strong>Plugins</strong> →{" "}
          <strong>PiwuApp Bridge</strong>. Hentikan Play/Run: plugin hanya
          bekerja di Edit Mode.
        </li>
        <li>
          Klik <strong>Buat token pasangan</strong> di bawah, lalu tempel token
          dan alamat ini ke panel plugin dan klik{" "}
          <strong>Simpan koneksi di memori</strong>.
        </li>
        <li>
          Kalau Studio bertanya “Allow PiwuStudio to access …?” pilih{" "}
          <strong>Allow</strong>. Pernah ditolak? View →{" "}
          <strong>Plugin Management</strong> → izinkan alamat ini, lalu klik{" "}
          <strong>Tes koneksi</strong> lagi.
        </li>
        <li>
          <strong>Kirim snapshot</strong> di Studio — AI langsung bisa membaca
          source-nya. <strong>Impor snapshot</strong> di sini hanya bila Anda
          ingin mengedit file di web; setelah itu review bundle lalu Terapkan di
          plugin (dua klik konfirmasi).
        </li>
      </ol>
      <p>
        Plugin tidak bisa memasang dirinya sendiri dan tidak bisa mengimpor
        berkas mesh — dua hal itu tetap dilakukan di Studio oleh Anda. Sumber
        plugin bisa diperiksa atau ditempel manual:{" "}
        <a href="/plugins/PiwuStudio.rbxmx" download="PiwuStudio.rbxmx">
          .rbxmx
        </a>{" "}
        (sekali pasang) atau{" "}
        <a href="/plugins/PiwuStudio.luau" download="PiwuStudio.luau">
          .luau
        </a>{" "}
        (Script → Save as Local Plugin, seperti panduan lama di docs/ROBLOX.md).
      </p>
      <p>
        Maksimal 750 instance / 140 script / 4 MB per snapshot; jika terlampaui,
        ekspor ditolak, bukan dipotong. Panel plugin memeriksa antrean tiap 20
        detik dan hanya <em>memberi tahu</em> bila ada perubahan menunggu —
        tidak menerapkan apa pun tanpa klik Anda.
      </p>
      <pre>{location.origin}</pre>
      <button
        disabled={busy || readOnly}
        onClick={() =>
          void run(async () => {
            const d = await projectApi(project.id, "studio/connect", {});
            setCredential(d.token);
            setStatus(
              "Token berlaku 30 menit. Tempel hanya ke plugin lokal milik Anda.",
            );
          })
        }
      >
        Buat token pasangan
      </button>
      {credential && (
        <label>
          Token plugin · hanya sesi ini
          <input
            type="password"
            readOnly
            value={credential}
            onFocus={(e) => e.target.select()}
          />
          <button
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(credential);
                setStatus(
                  "Token disalin. Jangan bagikan atau simpan dalam script game.",
                );
              })
            }
          >
            Salin token
          </button>
        </label>
      )}
      <button
        disabled={busy || readOnly}
        onClick={() =>
          void run(async () => {
            await projectApi(project.id, "studio", undefined, "DELETE");
            setCredential("");
            setStatus("Akses plugin dicabut.");
          })
        }
      >
        Cabut akses plugin
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await check();
          })
        }
      >
        Periksa koneksi
      </button>
      <button
        disabled={busy || readOnly}
        onClick={() =>
          void run(async () => {
            const d = await check();
            if (!d.snapshot)
              throw Error(
                "Klik Kirim snapshot di plugin Studio terlebih dahulu.",
              );
            if (
              project.files[DESIRED] &&
              !confirm(
                "Ganti draft Explorer dan script dengan snapshot Studio? Versi sebelumnya tetap ada di Riwayat.",
              )
            )
              return;
            importSnapshot(d.snapshot);
          })
        }
      >
        Impor snapshot Studio
      </button>
      <p role="status">{busy ? "Memproses…" : status}</p>
      {error && (
        <p role="alert" className="rb-error">
          {error}
        </p>
      )}
      {desired && (
        <>
          <h3>EXPLORER · DRAFT</h3>
          <div className="rb-studio-tree">{tree(null)}</div>
          <p>
            Objek terpilih:{" "}
            {node ? `${node.name} (${node.className})` : "belum ada"}. Script
            dibuka melalui Explorer file IDE.
          </p>
          {node?.scriptPath && (
            <button onClick={() => onOpenFile(node.scriptPath!)}>
              Buka script terpilih
            </button>
          )}
          <fieldset disabled={readOnly || busy}>
            <label>
              Nama objek
              <input
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Class baru
              <select value={cls} onChange={(e) => setCls(e.target.value)}>
                {editableClasses.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                void run(async () => {
                  if (!node) throw Error("Pilih parent di Explorer.");
                  const id = crypto.randomUUID();
                  const ancestry: string[] = [];
                  let parent: StudioNode | undefined = node;
                  while (parent) {
                    ancestry.unshift(
                      parent.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 35),
                    );
                    parent = desired!.nodes.find(
                      (n) => n.id === parent!.parentId,
                    );
                  }
                  const scriptPath = [
                    "Script",
                    "LocalScript",
                    "ModuleScript",
                  ].includes(cls)
                    ? `${ancestry.join("/")}/${name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 35)}_${id.slice(0, 8)}${cls === "Script" ? ".server" : cls === "LocalScript" ? ".client" : ""}.luau`
                    : undefined;
                  const n: StudioNode = {
                    id,
                    parentId: node.id,
                    name,
                    className: cls,
                    properties: {},
                    ...(scriptPath ? { scriptPath, readable: true } : {}),
                  };
                  const next = snapshotSchema.parse({
                    ...desired,
                    nodes: [...desired.nodes, n],
                  });
                  apply(
                    {
                      [DESIRED]: JSON.stringify(next, null, 2),
                      ...(scriptPath
                        ? {
                            [scriptPath]:
                              cls === "ModuleScript"
                                ? "--!strict\nreturn {}\n"
                                : "--!strict\n-- Script baru dinonaktifkan saat diimpor; aktifkan setelah review di Studio.\n",
                          }
                        : {}),
                    },
                    "Tambah instance Studio",
                  );
                  setSelected(id);
                })
              }
            >
              Tambah di dalam pilihan
            </button>
            <button
              disabled={!node?.parentId}
              onClick={() =>
                void run(async () => {
                  if (!node) return;
                  saveDesired({
                    ...desired,
                    nodes: desired.nodes.map((n) =>
                      n.id === selected ? { ...n, name } : n,
                    ),
                  });
                })
              }
            >
              Ganti nama pilihan
            </button>
            <button
              disabled={!node?.parentId}
              onClick={() =>
                void run(async () => {
                  if (
                    !node ||
                    !confirm(
                      "Hapus " +
                        node.name +
                        " dan semua descendants dari draft? Studio belum berubah sampai bundle diterapkan.",
                    )
                  )
                    return;
                  const removed = new Set([node.id]);
                  let count = -1;
                  while (count !== removed.size) {
                    count = removed.size;
                    for (const n of desired.nodes)
                      if (n.parentId && removed.has(n.parentId))
                        removed.add(n.id);
                  }
                  saveDesired({
                    ...desired,
                    nodes: desired.nodes.filter((n) => !removed.has(n.id)),
                  });
                })
              }
            >
              Hapus pilihan & descendants
            </button>
            <button onClick={() => void run(async () => importGeometry())}>
              Masukkan Part/Model dari builder
            </button>
          </fieldset>
          <button onClick={() => onOpenFile(DESIRED)}>
            Buka draft JSON / reparent
          </button>
          <button
            disabled={busy || readOnly}
            onClick={() =>
              void run(async () => {
                build();
              })
            }
          >
            Tinjau perubahan Studio
          </button>
        </>
      )}
      {bundle && (
        <>
          <h3>REVIEW · {bundle.changes.length} perubahan</h3>
          <pre>
            {bundle.changes
              .map(
                (c) =>
                  c.op +
                  " · " +
                  (c.op === "delete"
                    ? c.id
                    : c.node.name + " / " + c.node.className),
              )
              .join("\n") || "Tidak ada perubahan."}
          </pre>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            Saya meninjau perubahan, termasuk penghapusan dan source script.
          </label>
          <button
            disabled={!confirmed || !bundle.changes.length || busy || readOnly}
            onClick={() =>
              void run(async () => {
                const current = build();
                if (
                  JSON.stringify(current.changes) !==
                  JSON.stringify(bundle.changes)
                )
                  throw Error("Draft berubah. Tinjau ulang.");
                await projectApi(project.id, "studio/send", bundle);
                setStatus(
                  "Bundle diantrekan, BELUM diterapkan. Klik Ambil perubahan, lalu Terapkan di plugin Studio.",
                );
                setBundle(null);
              })
            }
          >
            Kirim bundle ke Studio
          </button>
          <button
            onClick={() =>
              downloadText(
                "piwu-studio-changes.json",
                JSON.stringify(bundle, null, 2),
              )
            }
          >
            Unduh bundle untuk pemeriksaan
          </button>
        </>
      )}
      <p>
        Studio Play Test, terrain/CSG, class terlindungi, dan publikasi game
        tidak dijalankan di browser. Perubahan di Studio setelah snapshot
        menyebabkan konflik, bukan ditimpa otomatis.
      </p>
    </div>
  );
}
