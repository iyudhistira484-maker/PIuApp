import { nudgeOnMap } from "../../lib/roblox/map";
import type { ViewTool } from "./SceneViewport";
import { downloadBytes, downloadText } from "../../lib/download";
import { useMemo, useState, useEffect, lazy, Suspense } from "react";
import {
  Box,
  Layers,
  Plus,
  Trash2,
  Download,
  Upload,
  Link2,
  PanelLeft,
  PanelRight,
  ArrowLeft,
  MousePointer2,
  Move,
  RotateCw,
  Scaling,
} from "lucide-react";
import type { Project } from "../../lib/types";
import { useStore } from "../../lib/store";
import {
  SCENE_PATH,
  sceneSchema,
  newObject,
  deleteObject,
  meshOBJ,
  parseOBJ,
  type SceneObject,
  type RobloxScene,
} from "../../lib/roblox/scene";
import { bakeAtlas } from "../../lib/roblox/atlas";
import { objectGLB } from "../../lib/roblox/glb";
import { photoSize } from "../../lib/photo-assets";
import type { ProjectPhotoMeta } from "../../lib/photo-assets";
import {
  listProjectPhotos,
  readProjectPhoto,
} from "../../services/project-photos";
import { scopeFor } from "../../lib/cloud/types";
import { projectApi } from "../../services/api";
import StudioBridge from "./StudioBridge";
import "./roblox.css";
const SceneViewport = lazy(() => import("./SceneViewport"));
/**
 * base64 for a binary .glb, in chunks. A single String.fromCharCode(...bytes)
 * on a multi-megabyte mesh would overflow the call stack, and this file is
 * uploaded as JSON.
 */
function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/**
 * Export with a texture. Roblox's importer reads textures from glTF, not from
 * OBJ, so a .glb is what makes the photo colours arrive as a real texture — and
 * the atlas can only be baked from a photo this browser still holds.
 */
function TextureExport({
  object,
  projectId,
}: {
  object: SceneObject;
  projectId: string;
}) {
  const user = useStore((s) => s.user);
  const notify = useStore((s) => s.notify);
  const [photos, setPhotos] = useState<ProjectPhotoMeta[]>([]);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const load = async () => {
      const list = await listProjectPhotos(scopeFor(user), projectId).catch(
        () => [],
      );
      setPhotos(list);
      setChosen((current) => current || list[0]?.id || "");
    };
    void load();
  }, [projectId, user]);
  const groups = object.mesh?.groups || [];
  const build = async (withTexture: boolean) => {
    let texturePng: Uint8Array | undefined;
    let atlas: Awaited<ReturnType<typeof bakeAtlas>>["plan"] | undefined;
    if (withTexture) {
      const photo = await readProjectPhoto(scopeFor(user), projectId, chosen);
      if (!photo) throw new Error("Foto itu sudah tidak ada di browser ini.");
      const baked = await bakeAtlas(photo, object.mesh!);
      texturePng = baked.png;
      atlas = baked.plan;
    }
    return { file: objectGLB(object, { texturePng }), atlas };
  };
  const run = async (withTexture: boolean) => {
    setError("");
    setBusy(withTexture ? "Menyiapkan atlas…" : "Menyiapkan GLB…");
    try {
      const { file, atlas } = await build(withTexture);
      downloadBytes(
        `${(object.name || "model").replace(/[^a-zA-Z0-9_-]/g, "-")}${withTexture ? "-bertekstur" : ""}.glb`,
        file,
      );
      const patches = atlas?.patches.length || 0;
      notify(
        withTexture
          ? `GLB bertesktur tersimpan: ${patches} potongan foto pada atlas ${atlas!.layout.size}px, UV per sisi. Impor di Studio lewat 3D Importer (glTF) — teksturnya ikut.`
          : "GLB warna tersimpan (tanpa tekstur): warna tiap sisi dari foto tetap ada sebagai vertex colour.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ekspor gagal.");
    } finally {
      setBusy("");
    }
  };
  // The optional route: only a server that holds an Open Cloud key with the
  // asset:write scope can upload for you. Without one the answer is a refusal,
  // and the manual download above stays the way in.
  const upload = async (withTexture: boolean) => {
    setError("");
    setBusy(withTexture ? "Menyiapkan atlas…" : "Menyiapkan GLB…");
    try {
      const { file } = await build(withTexture);
      setBusy("Mengunggah ke Roblox…");
      const uploaded = await projectApi(projectId, "studio/assets", {
        name: object.name || "Mesh",
        objectId: object.id,
        glb: toBase64(file),
      });
      notify(
        `Terunggah ke Roblox sebagai aset ${uploaded.assetId} (${uploaded.bytes} byte). ${uploaded.note || ""} Id-nya tersimpan di studio.assets.json untuk objek ini, jadi impor scene di plugin akan memakai MeshPart aset tersebut.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unggahan ke Roblox gagal.",
      );
    } finally {
      setBusy("");
    }
  };
  return (
    <details className="rb-glb" open>
      <summary>Ekspor GLB (bertesktur)</summary>
      <p>
        glTF yang dibaca Roblox beserta teksturnya: atlas dibuat dari foto
        project yang tersimpan di browser ini, tiap sisi memakai potongan foto
        di area yang jadi sumber warnanya. Bukan peta UV hasil unwrap — ini
        proyeksi kotak per sisi.
      </p>
      {photos.length ? (
        <label>
          Foto untuk atlas
          <select
            aria-label="Foto untuk atlas"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            {photos.map((photo) => (
              <option key={photo.id} value={photo.id}>
                {photo.name} · {photoSize(photo.bytes)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="rb-glb-note">
          Belum ada foto project di browser ini. Lampirkan foto di chat dan
          minta model 3D darinya — fotonya tersimpan sebagai aset project, lalu
          bisa dipakai sebagai tekstur di sini.
        </p>
      )}
      <button
        type="button"
        className="rb-primary"
        disabled={!photos.length || !!busy}
        onClick={() => void run(true)}
      >
        <Download size={14} /> Unduh GLB bertesktur
      </button>
      <button type="button" disabled={!!busy} onClick={() => void run(false)}>
        <Download size={14} /> GLB warna saja
      </button>
      <button
        type="button"
        disabled={!photos.length || !!busy}
        onClick={() => void upload(true)}
        title="Butuh kunci Open Cloud (scope asset:write) di server PiwuApp"
      >
        <Upload size={14} /> Unggah ke Roblox (Open Cloud)
      </button>
      <small className="rb-glb-note">
        Unggah otomatis hanya jalan bila server PiwuApp punya kunci Open Cloud
        dengan scope <code>asset:write</code>. Kalau tidak, tombol ini
        menjelaskan kenapa dan jalur 3D Importer tetap tersedia.
      </small>
      {groups.length ? (
        <small className="rb-glb-note">
          {groups.length} grup sisi, {groups.filter((g) => g.region).length} di
          antaranya punya area foto; UV tiap sisi mengikuti patch grupnya.
        </small>
      ) : (
        <small className="rb-glb-note">
          Objek ini belum punya grup sisi, jadi atlasnya berisi satu warna objek
          saja.
        </small>
      )}
      {busy && <small className="rb-glb-note">{busy}</small>}
      {error && (
        <p role="alert" className="rb-error">
          {error}
        </p>
      )}
    </details>
  );
}

export default function RobloxBuilder({
  project,
  readOnly,
  onOpenFile,
  mode = "3d",
  onModeChange,
  draft = false,
}: {
  mode?: "3d" | "map";
  onModeChange?: (mode: "3d" | "map") => void;
  draft?: boolean;
  project: Project;
  readOnly: boolean;
  onOpenFile: (path: string) => void;
}) {
  const [selected, setSelected] = useState("baseplate"),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"build" | "bridge">("build");
  const [tool, setTool] = useState<ViewTool>("select"),
    [snap, setSnap] = useState(1),
    [frame, setFrame] = useState(0);
  useEffect(() => setTab("build"), [mode, draft]);
  const [showExplorer, setShowExplorer] = useState(true),
    [showProperties, setShowProperties] = useState(true);
  const parsed = useMemo(() => {
    try {
      return {
        scene: sceneSchema.parse(JSON.parse(project.files[SCENE_PATH] || "")),
        error: "",
      };
    } catch (e) {
      return {
        scene: null,
        error:
          "Scene tidak valid. Perbaiki scene.roblox.json atau pulihkan versi sebelumnya. " +
          (e instanceof Error ? e.message.slice(0, 180) : ""),
      };
    }
  }, [project.files[SCENE_PATH]]);
  const commit = (scene: RobloxScene, label: string) => {
    if (readOnly) return;
    try {
      sceneSchema.parse(scene);
      const json = JSON.stringify(scene, null, 2);
      if (json.length > 240000)
        throw new Error("Scene terlalu besar untuk satu file project.");
      useStore.getState().applyFiles(project.id, { [SCENE_PATH]: json }, label);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scene gagal disimpan.");
    }
  };
  const scene = parsed.scene;
  const current = scene?.objects.find((o) => o.id === selected);
  const add = (kind: SceneObject["kind"]) => {
    if (!scene) return;
    const o = newObject(kind);
    commit({ ...scene, objects: [...scene.objects, o] }, "Tambah " + kind);
    setSelected(o.id);
  };
  const nudge = (x: number, z: number) => {
    if (!scene || readOnly) return;
    try {
      commit(
        nudgeOnMap(scene, selected, x * (snap || 1), z * (snap || 1)),
        "Geser objek di canvas map",
      );
    } catch {
      setError("Perpindahan melampaui batas scene (±10.000 stud).");
    }
  };
  function tree(parent: string | null, depth = 0): React.ReactNode {
    return scene?.objects
      .filter((o) => o.parent === parent)
      .map((o) => (
        <div key={o.id}>
          <button
            title={o.name}
            style={{ paddingLeft: 12 + depth * 14 }}
            className={o.id === selected ? "selected" : ""}
            onClick={() => setSelected(o.id)}
            aria-pressed={o.id === selected}
          >
            {o.kind === "model" ? <Layers size={14} /> : <Box size={14} />}
            <span>{o.name}</span>
            <small>{o.kind}</small>
          </button>
          {tree(o.id, depth + 1)}
        </div>
      ));
  }
  return (
    <section className="rb-workbench" aria-label="Roblox 3D Builder">
      <header className="rb-top">
        <div className="rb-heading">
          <Box size={16} />
          <div>
            <strong>
              {tab === "bridge"
                ? "Koneksi Studio"
                : mode === "map"
                  ? "Canvas Map"
                  : "Preview 3D"}
            </strong>
            <span>Roblox / Workspace</span>
          </div>
        </div>
        <div className="rb-header-actions">
          {tab === "build" && (
            <div
              className="rb-panel-switches"
              role="group"
              aria-label="Panel scene"
            >
              <button
                aria-label="Tampilkan atau sembunyikan Explorer scene"
                title="Explorer scene"
                aria-pressed={showExplorer}
                onClick={() => setShowExplorer((v) => !v)}
              >
                <PanelLeft size={15} />
              </button>
              <button
                aria-label="Tampilkan atau sembunyikan properti scene"
                title="Properti scene"
                aria-pressed={showProperties}
                onClick={() => setShowProperties((v) => !v)}
              >
                <PanelRight size={15} />
              </button>
            </div>
          )}
          <button
            disabled={draft}
            onClick={() => setTab(tab === "bridge" ? "build" : "bridge")}
          >
            {tab === "bridge" ? <ArrowLeft size={14} /> : <Link2 size={14} />}
            {tab === "bridge" ? "Kembali ke scene" : "Hubungkan Studio"}
          </button>
        </div>
      </header>
      {tab === "bridge" ? (
        <StudioBridge
          project={project}
          readOnly={readOnly}
          onOpenFile={onOpenFile}
        />
      ) : (
        <>
          <div className="rb-scene-status" role="status">
            <span className="rb-live-dot" />
            <span>
              {draft
                ? "Usulan AI · belum disimpan · preview hanya baca"
                : "Hasil scene tersimpan · perubahan masuk Riwayat"}
            </span>
            <code>scene.roblox.json</code>
          </div>
          <div className="rb-tools">
            <span>Tambah</span>
            {(["block", "sphere", "cylinder", "model", "mesh"] as const).map(
              (k, i) => (
                <button
                  disabled={readOnly || !scene}
                  key={k}
                  onClick={() => add(k)}
                >
                  <Plus size={13} />
                  {["Balok", "Bola", "Silinder", "Model", "Mesh kosong"][i]}
                </button>
              ),
            )}
            <label className="rb-file">
              <Upload size={13} /> Impor OBJ
              <input
                disabled={readOnly || !scene}
                type="file"
                accept=".obj"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f || !scene) return;
                  try {
                    if (f.size > 1000000) throw new Error("OBJ maksimal 1 MB.");
                    const o = parseOBJ(await f.text());
                    commit(
                      { ...scene, objects: [...scene.objects, o] },
                      "Impor mesh OBJ",
                    );
                    setSelected(o.id);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Impor gagal");
                  }
                }}
              />
            </label>
          </div>
          <div className="rb-map-tools" aria-label="Alat scene Roblox">
            <div role="group" aria-label="Manipulasi objek">
              {(["select", "translate", "rotate", "scale"] as const).map(
                (t, i) => (
                  <button
                    key={t}
                    disabled={
                      t !== "select" &&
                      (readOnly ||
                        !current ||
                        (t === "scale" && current.kind === "model"))
                    }
                    aria-pressed={tool === t}
                    onClick={() => setTool(t)}
                  >
                    {(() => {
                      const Icon = [MousePointer2, Move, RotateCw, Scaling][i];
                      return <Icon size={14} />;
                    })()}
                    {["Pilih", "Geser", "Putar", "Ukuran"][i]}
                  </button>
                ),
              )}
            </div>
            <label>
              Snap{" "}
              <select
                aria-label="Snap grid"
                value={snap}
                onChange={(e) => setSnap(Number(e.target.value))}
              >
                {[0, 0.5, 1, 2, 4].map((n) => (
                  <option key={n} value={n}>
                    {n ? n + " stud" : "Bebas"}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => setFrame((n) => n + 1)}>
              Bingkai semua
            </button>
            {mode === "map" && (
              <div role="group" aria-label="Geser di map">
                {(
                  [
                    [-1, 0, "Kiri"],
                    [1, 0, "Kanan"],
                    [0, -1, "Atas"],
                    [0, 1, "Bawah"],
                  ] as const
                ).map(([x, z, label]) => (
                  <button
                    key={label}
                    aria-label={"Geser map " + label.toLowerCase()}
                    disabled={readOnly || !current}
                    onClick={() => nudge(x, z)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {(error || parsed.error) && (
            <p className="rb-error" role="alert">
              {error || parsed.error}
            </p>
          )}
          <div
            className={
              "rb-layout" +
              (!showExplorer ? " is-explorer-hidden" : "") +
              (!showProperties ? " is-properties-hidden" : "")
            }
          >
            {showExplorer && (
              <aside className="rb-explorer">
                <h3>
                  <span>EXPLORER</span>
                  <span>{scene?.objects.length || 0}</span>
                </h3>
                {scene?.objects.length ? (
                  tree(null)
                ) : (
                  <p>Belum ada objek. Tambahkan Part atau Model.</p>
                )}
                <button onClick={() => onOpenFile(SCENE_PATH)}>
                  Buka scene JSON
                </button>
              </aside>
            )}
            {scene ? (
              <Suspense fallback={<p>Memuat renderer 3D…</p>}>
                <SceneViewport
                  scene={scene}
                  selected={selected}
                  onSelect={setSelected}
                  mode={mode}
                  tool={tool}
                  snap={snap}
                  readOnly={readOnly}
                  frameRequest={frame + (draft ? 100000 : 0)}
                  onNudge={nudge}
                  onTransform={(objectId, values) =>
                    commit(
                      {
                        ...scene,
                        objects: scene.objects.map((o) =>
                          o.id === objectId ? { ...o, ...values } : o,
                        ),
                      },
                      "Transformasi objek di canvas",
                    )
                  }
                />
              </Suspense>
            ) : (
              <div className="rb-viewport">
                <p>Preview tidak dijalankan untuk scene yang tidak valid.</p>
              </div>
            )}
            {showProperties && (
              <aside className="rb-properties">
                <h3>PROPERTI</h3>
                {current && scene ? (
                  <ObjectProperties
                    key={current.id + JSON.stringify(current)}
                    object={current}
                    objects={scene.objects}
                    projectId={project.id}
                    readOnly={readOnly}
                    onSave={(o) =>
                      commit(
                        {
                          ...scene,
                          objects: scene.objects.map((n) =>
                            n.id === o.id ? o : n,
                          ),
                        },
                        "Ubah " + o.name,
                      )
                    }
                    onDelete={() => {
                      if (
                        confirm(
                          "Hapus " +
                            current.name +
                            " beserta objek di dalamnya? Perubahan dapat dipulihkan di Riwayat.",
                        )
                      ) {
                        commit(
                          deleteObject(scene, current.id),
                          "Hapus " + current.name,
                        );
                        setSelected("");
                      }
                    }}
                  />
                ) : (
                  <p>Pilih objek di Explorer atau viewport.</p>
                )}
              </aside>
            )}
          </div>
          <footer className="rb-note">
            <span>
              {scene?.objects.length || 0}/250 objek · Stud ·{" "}
              {mode === "map" ? "Sumbu X / Z" : "Perspektif"}
            </span>
            <span title="Preview menampilkan geometri scene, bukan eksekusi Luau atau Play Test. Perubahan tersimpan ke Riwayat.">
              Preview geometri · bukan Play Test
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
function ObjectProperties({
  object,
  objects,
  projectId,
  readOnly,
  onSave,
  onDelete,
}: {
  object: SceneObject;
  objects: SceneObject[];
  projectId: string;
  readOnly: boolean;
  onSave: (o: SceneObject) => void;
  onDelete: () => void;
}) {
  const [o, set] = useState(object),
    [vertices, setVertices] = useState(
      object.mesh?.vertices.map((v) => v.join(" ")).join("\n") || "",
    ),
    [faces, setFaces] = useState(
      object.mesh?.faces.map((v) => v.join(" ")).join("\n") || "",
    ),
    [error, setError] = useState("");
  const vector = (key: "position" | "rotation" | "size", label: string) => (
    <label>
      {label}
      <div className="rb-vector">
        {["X", "Y", "Z"].map((axis, i) => (
          <input
            aria-label={`${label} ${axis}`}
            key={axis}
            type="number"
            step="0.1"
            required
            value={o[key][i]}
            onChange={(e) =>
              set({
                ...o,
                [key]: o[key].map((v, j) =>
                  j === i ? Number(e.target.value) : v,
                ),
              })
            }
          />
        ))}
      </div>
    </label>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const next = {
            ...o,
            ...(o.kind === "mesh"
              ? {
                  mesh: {
                    vertices: vertices
                      .trim()
                      .split(/\n/)
                      .filter(Boolean)
                      .map((l) => l.trim().split(/\s+/).map(Number)),
                    faces: faces
                      .trim()
                      .split(/\n/)
                      .filter(Boolean)
                      .map((l) => l.trim().split(/\s+/).map(Number)),
                  },
                }
              : {}),
          };
          const valid = sceneSchema.parse({
            version: 1,
            objects: objects.map((n) => (n.id === o.id ? next : n)),
          });
          onSave(valid.objects.find((n) => n.id === o.id)!);
          setError("");
        } catch {
          setError(
            "Periksa angka, parent, dan indeks mesh. Face memakai tiga indeks vertex berbeda mulai dari 0.",
          );
        }
      }}
    >
      <fieldset disabled={readOnly}>
        <label>
          Nama
          <input
            value={o.name}
            maxLength={80}
            required
            onChange={(e) => set({ ...o, name: e.target.value })}
          />
        </label>
        <label>
          Parent
          <select
            value={o.parent || ""}
            onChange={(e) => set({ ...o, parent: e.target.value || null })}
          >
            <option value="">Workspace</option>
            {objects
              .filter((n) => n.kind === "model" && n.id !== o.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
        </label>
        {vector("position", "Posisi")}
        {vector("rotation", "Rotasi °")}
        {o.kind !== "model" && (
          <>
            {vector("size", "Ukuran")}
            <label>
              Warna
              <input
                type="color"
                value={o.color}
                onChange={(e) => set({ ...o, color: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={o.anchored}
                onChange={(e) => set({ ...o, anchored: e.target.checked })}
              />{" "}
              Anchored
            </label>
          </>
        )}
        {o.kind === "mesh" && (
          <details open>
            <summary>Editor mesh dasar</summary>
            <p>
              Ubah vertex dan susun segitiga. Koordinat lokal; face memakai
              indeks mulai dari 0.
            </p>
            <label>
              Vertices · X Y Z per baris
              <textarea
                aria-label="Vertices mesh"
                rows={6}
                value={vertices}
                onChange={(e) => setVertices(e.target.value)}
              />
            </label>
            <label>
              Faces · tiga indeks per baris
              <textarea
                aria-label="Faces mesh"
                rows={4}
                value={faces}
                onChange={(e) => setFaces(e.target.value)}
              />
            </label>
          </details>
        )}
        {error && (
          <p role="alert" className="rb-error">
            {error}
          </p>
        )}
        <button className="rb-primary" type="submit">
          Simpan properti
        </button>
        <button type="button" onClick={onDelete}>
          <Trash2 size={14} /> Hapus objek
        </button>
      </fieldset>
      {object.mesh && (
        <>
          <button
            type="button"
            onClick={() =>
              downloadText("piwu-mesh.obj", meshOBJ(object), "text/plain")
            }
          >
            <Download size={14} /> Ekspor OBJ tersimpan
          </button>
          <TextureExport object={object} projectId={projectId} />
        </>
      )}
    </form>
  );
}
