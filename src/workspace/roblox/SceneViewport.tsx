import { useIDETheme } from "../IDETheme";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { RobloxScene, SceneObject } from "../../lib/roblox/scene";
import { meshPhotoColors } from "../../lib/roblox/scene";
export type ViewTool = "select" | "translate" | "rotate" | "scale";
export default function SceneViewport({
  scene,
  selected,
  onSelect,
  mode = "3d",
  tool = "select",
  snap = 1,
  readOnly = false,
  onTransform,
  frameRequest = 0,
  onNudge,
}: {
  scene: RobloxScene;
  selected: string;
  onSelect: (id: string) => void;
  mode?: "3d" | "map";
  tool?: ViewTool;
  snap?: number;
  readOnly?: boolean;
  onTransform?: (
    id: string,
    values: Pick<SceneObject, "position" | "rotation" | "size">,
  ) => void;
  frameRequest?: number;
  onNudge?: (x: number, z: number) => void;
}) {
  const { theme } = useIDETheme();
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, onTransform, onNudge });
  callbacks.current = { onSelect, onTransform, onNudge };
  const [error, setError] = useState("");
  const cameras = useRef<
    Record<string, { position: number[]; target: number[]; zoom: number }>
  >({});
  const lastFrame = useRef(frameRequest);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!host.current) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
      });
    } catch {
      setError(
        "WebGL tidak tersedia. Explorer dan properti tetap bisa digunakan; aktifkan akselerasi grafis untuk preview 3D.",
      );
      return;
    }
    setError("");
    const el = host.current;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(theme === "light" ? "#f0f3f7" : "#1c222b");
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      mode === "map"
        ? "Canvas map Roblox tampak atas"
        : "Preview 3D hasil scene Roblox",
    );
    renderer.domElement.tabIndex = 0;
    if (restoreFocus.current)
      renderer.domElement.focus({ preventScroll: true });
    const world = new THREE.Scene(),
      content = new THREE.Group();
    world.add(content);
    const camera =
      mode === "map"
        ? new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 100000)
        : new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
    if (mode === "map") camera.up.set(0, 0, -1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = mode !== "map";
    controls.screenSpacePanning = true;
    if (mode === "map") controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    world.add(new THREE.HemisphereLight(0xe5f0ff, 0x445045, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(25, 50, 20);
    world.add(sun);
    const objects = new Map<string, THREE.Object3D>(),
      pickable: THREE.Object3D[] = [];
    for (const item of scene.objects) {
      let obj: THREE.Object3D;
      if (item.kind === "model") obj = new THREE.Group();
      else {
        let geometry: THREE.BufferGeometry;
        if (item.kind === "sphere")
          geometry = new THREE.SphereGeometry(0.5, 24, 16);
        else if (item.kind === "cylinder") {
          geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
          geometry.rotateZ(Math.PI / 2);
        } else if (item.kind === "mesh" && item.mesh) {
          const photo = item.mesh.groups?.length
            ? meshPhotoColors(item.mesh, item.color)
            : null;
          geometry = new THREE.BufferGeometry();
          if (photo) {
            // Photo-coloured mesh: one flat colour per face, so the surface reads
            // like the photo instead of one flat object colour. The geometry is
            // expanded (a shared vertex cannot hold two face colours).
            geometry.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(photo.position, 3),
            );
            geometry.setAttribute(
              "color",
              new THREE.Float32BufferAttribute(photo.color, 3),
            );
          } else {
            geometry.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(item.mesh.vertices.flat(), 3),
            );
            geometry.setIndex(item.mesh.faces.flat());
          }
          geometry.computeVertexNormals();
        } else geometry = new THREE.BoxGeometry(1, 1, 1);
        obj = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: item.color,
            // A grouped mesh carries its own per-face colours; multiplying them
            // by `color` would darken the photo's colours, so the base stays
            // white for those.
            ...(item.mesh?.groups?.length ? { color: 0xffffff } : {}),
            vertexColors: Boolean(item.mesh?.groups?.length),
            roughness: 0.7,
            metalness: 0.05,
            side: THREE.DoubleSide,
            emissive: item.id === selected ? 0x184b65 : 0x000000,
            emissiveIntensity: 0.4,
          }),
        );
        obj.scale.fromArray(item.size);
        pickable.push(obj);
      }
      obj.position.fromArray(item.position);
      obj.rotation.set(
        ...(item.rotation.map(THREE.MathUtils.degToRad) as [
          number,
          number,
          number,
        ]),
      );
      obj.userData.id = item.id;
      objects.set(item.id, obj);
    }
    for (const item of scene.objects)
      (item.parent ? objects.get(item.parent)! : content).add(
        objects.get(item.id)!,
      );
    world.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(content);
    const center = bounds.isEmpty()
      ? new THREE.Vector3()
      : bounds.getCenter(new THREE.Vector3());
    const dimensions = bounds.isEmpty()
      ? new THREE.Vector3(40, 10, 40)
      : bounds.getSize(new THREE.Vector3());
    const extent = Math.max(dimensions.x, dimensions.y, dimensions.z, 10);
    const aspect = Math.max(el.clientWidth, 1) / Math.max(el.clientHeight, 1);
    const gridSize = Math.max(100, Math.ceil(extent / 10) * 10);
    const grid = new THREE.GridHelper(
      gridSize,
      Math.min(100, gridSize),
      theme === "light" ? 0x94a3b8 : 0x627c84,
      theme === "light" ? 0xc0cbd8 : 0x35464d,
    );
    grid.position.set(
      center.x,
      mode === "map" && !bounds.isEmpty()
        ? bounds.max.y + 0.05
        : Math.min(bounds.isEmpty() ? 0 : bounds.min.y - 0.01, -0.01),
      center.z,
    );
    if (mode === "map") {
      const material = grid.material as THREE.Material;
      material.transparent = true;
      material.opacity = 0.18;
      material.depthWrite = false;
    }
    world.add(grid);
    const saved = cameras.current[mode];
    if (saved && lastFrame.current === frameRequest) {
      camera.position.fromArray(saved.position);
      controls.target.fromArray(saved.target);
      camera.zoom = saved.zoom;
    } else {
      controls.target.copy(center);
      if (camera instanceof THREE.OrthographicCamera) {
        camera.position
          .copy(center)
          .add(new THREE.Vector3(0, Math.max(100, extent * 2), 0));
        camera.zoom = Math.min(
          (60 * aspect) / Math.max(dimensions.x * 1.3, 10),
          60 / Math.max(dimensions.z * 1.3, 10),
        );
      } else {
        const distance = (extent * 1.65) / Math.min(aspect, 1);
        camera.position
          .copy(center)
          .add(
            new THREE.Vector3(0.8, 0.7, 1).normalize().multiplyScalar(distance),
          );
      }
    }
    lastFrame.current = frameRequest;
    controls.update();
    const chosen = objects.get(selected);
    const box = chosen
      ? new THREE.BoxHelper(chosen, theme === "light" ? 0x237cc4 : 0x81d6df)
      : null;
    if (box) world.add(box);
    const transform = new TransformControls(camera, renderer.domElement);
    let wasTransform = false;
    const helper = transform.getHelper();
    if (
      !readOnly &&
      tool !== "select" &&
      chosen &&
      !(
        tool === "scale" &&
        scene.objects.find((o) => o.id === selected)?.kind === "model"
      )
    ) {
      transform.setMode(tool);
      transform.setSpace(
        tool === "translate" || (mode === "map" && tool === "rotate")
          ? "world"
          : "local",
      );
      transform.setTranslationSnap(snap || null);
      transform.setRotationSnap(snap ? Math.PI / 12 : null);
      transform.setScaleSnap(snap ? 0.25 : null);
      if (mode === "map") {
        transform.showY = tool === "rotate";
        transform.showX = tool !== "rotate";
        transform.showZ = tool !== "rotate";
      }
      transform.attach(chosen);
      world.add(helper);
    }
    const draw = () => {
      box?.update();
      renderer.render(world, camera);
    };
    transform.addEventListener("change", draw);
    transform.addEventListener("dragging-changed", (e) => {
      controls.enabled = !e.value;
      if (e.value) wasTransform = true;
    });
    transform.addEventListener("mouseUp", () => {
      if (!chosen || readOnly) return;
      const item = scene.objects.find((o) => o.id === selected)!;
      const values = {
        position: chosen.position.toArray() as SceneObject["position"],
        rotation: [chosen.rotation.x, chosen.rotation.y, chosen.rotation.z].map(
          THREE.MathUtils.radToDeg,
        ) as SceneObject["rotation"],
        size:
          item.kind === "model"
            ? item.size
            : (chosen.scale.toArray() as SceneObject["size"]),
      };
      chosen.position.fromArray(item.position);
      chosen.rotation.set(
        ...(item.rotation.map(THREE.MathUtils.degToRad) as [
          number,
          number,
          number,
        ]),
      );
      if (item.kind !== "model") chosen.scale.fromArray(item.size);
      if (
        ["position", "rotation", "size"].some((k) =>
          values[k as keyof typeof values].some(
            (n, i) =>
              Math.abs(n - item[k as keyof typeof values][i]) > 0.000001,
          ),
        )
      )
        callbacks.current.onTransform?.(selected, values);
    });
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h;
      else {
        camera.left = (-30 * w) / h;
        camera.right = (30 * w) / h;
      }
      camera.updateProjectionMatrix();
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    controls.addEventListener("change", draw);
    resize();
    let start = [0, 0];
    const down = (e: PointerEvent) => {
      start = [e.clientX, e.clientY];
      wasTransform = !!transform.dragging;
    };
    const up = (e: PointerEvent) => {
      if (
        wasTransform ||
        e.button !== 0 ||
        Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4
      )
        return;
      const b = renderer.domElement.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - b.left) / b.width) * 2 - 1,
          -((e.clientY - b.top) / b.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(pickable, false)[0];
      if (hit) callbacks.current.onSelect(hit.object.userData.id);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") transform.reset();
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (
        mode === "map" &&
        !readOnly &&
        deltas[e.key] &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        callbacks.current.onNudge?.(...deltas[e.key]);
      }
    };
    const lost = (e: Event) => {
      e.preventDefault();
      setError(
        "Konteks grafis terputus. Beralih tampilan untuk memuat ulang preview; file scene tetap tersimpan.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("keydown", key);
    return () => {
      restoreFocus.current = document.activeElement === renderer.domElement;
      observer.disconnect();
      cameras.current[mode] = {
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        zoom: camera.zoom,
      };
      controls.dispose();
      transform.detach();
      world.remove(helper);
      transform.dispose();
      world.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            m.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [scene, selected, mode, tool, snap, readOnly, frameRequest, theme]);
  return (
    <div
      className="rb-viewport"
      style={{ height: "100%" }}
      ref={host}
      data-mode={mode}
      data-objects={scene.objects.length}
    >
      {error && (
        <p className="rb-graphics-error" role="alert">
          {error}
        </p>
      )}
      <span className="rb-viewport-label">
        {mode === "map"
          ? "TAMPAK ATAS · X / Z · STUD"
          : "PERSPEKTIF · HASIL SCENE 3D"}
        <br />
        {mode === "map"
          ? "Geser: pan · Roda: zoom · Panah: pindahkan pilihan"
          : "Geser: orbit · Roda: zoom · Klik: pilih"}
      </span>
      {!scene.objects.length && (
        <p className="rb-empty-scene">
          Scene kosong. Tambahkan objek atau minta AI membuat map.
        </p>
      )}
    </div>
  );
}
