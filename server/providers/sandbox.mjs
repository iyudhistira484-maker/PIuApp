import { Sandbox } from "e2b";
import JSZip from "jszip";
import { HttpError, validFiles, assertNoSecrets } from "../lib/core.mjs";
export const packageSpec =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9.*^~+_-]+)?$/;
export const shellQuote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const root = "/home/user/project";
export class SandboxProvider {
  constructor(env, coordination = null) {
    this.env = env;
    this.coordination = coordination;
    this.creating = new Set();
    this.sessions = new Map();
    this.busy = new Set();
  }
  async create() {
    if (!this.env.E2B_API_KEY)
      throw new HttpError(
        503,
        "Sandbox E2B belum dikonfigurasi. Perintah tidak dijalankan di server PiwuApp.",
      );
    const opts = {
      apiKey: this.env.E2B_API_KEY,
      timeoutMs: 600000,
      requestTimeoutMs: 60000,
      metadata: { application: "piwuapp" },
    };
    return this.env.E2B_TEMPLATE
      ? Sandbox.create(this.env.E2B_TEMPLATE, opts)
      : Sandbox.create(opts);
  }
  async write(box, files, onlyPaths = null) {
    validFiles(files);
    let pkg;
    try {
      pkg = JSON.parse(files["package.json"] || "{}");
    } catch {
      throw new HttpError(400, "package.json tidak valid.");
    }
    const contents = {
      ...files,
      "package.json": JSON.stringify({
        ...pkg,
        scripts: {
          ...pkg.scripts,
          dev: "vite --host 0.0.0.0 --port 5173 --strictPort",
          build: "vite build",
        },
        dependencies: {
          ...pkg.dependencies,
          react: pkg.dependencies?.react || "^19.0.0",
          "react-dom": pkg.dependencies?.["react-dom"] || "^19.0.0",
        },
        devDependencies: {
          ...pkg.devDependencies,
          vite: pkg.devDependencies?.vite || "^6.0.0",
        },
      }),
    };
    await box.commands.run("mkdir -p " + root);
    await box.files.write(
      Object.entries(contents)
        .filter(([path]) => !onlyPaths || onlyPaths.includes(path))
        .map(([path, data]) => ({ path: root + "/" + path, data })),
    );
    if (
      !onlyPaths &&
      !Object.keys(files).some((p) => /^vite\.config\.[cm]?[jt]s$/.test(p))
    )
      await box.files.write(
        root + "/vite.config.mjs",
        `export default {server:{host:'0.0.0.0',port:5173,strictPort:true,allowedHosts:true,cors:true}};`,
      );
  }
  async forProject(user, id, files) {
    for (const [key, entry] of this.sessions)
      if (entry.expires < Date.now() && !this.busy.has(key)) {
        try {
          await entry.box.kill();
        } catch {
          if (Date.now() < entry.expires + 60000) continue;
        }
        this.sessions.delete(key);
        await this.coordination?.releaseSlot(...key.split(":")).catch(() => {});
      }
    if (
      !this.sessions.has(user + ":" + id) &&
      (this.sessions.size + this.creating.size >= 50 ||
        [...this.sessions.keys(), ...this.creating].filter((k) =>
          k.startsWith(user + ":"),
        ).length >= 2)
    )
      throw new HttpError(
        429,
        "Maksimal dua sandbox aktif per akun. Hentikan sandbox lain terlebih dahulu.",
      );
    const key = user + ":" + id;
    let entry = this.sessions.get(key);
    if (entry && entry.expires > Date.now()) {
      const changed = Object.keys(files).filter(
        (p) => entry.source[p] !== files[p],
      );
      for (const path of Object.keys(entry.source))
        if (!(path in files))
          await entry.box.files.remove(root + "/" + path).catch(() => {});
      if (changed.length) await this.write(entry.box, files, changed);
      entry.source = { ...files };
      return entry;
    }
    if (entry) {
      await entry.box.kill().catch(() => {});
      this.sessions.delete(key);
    }
    this.creating.add(key);
    let box;
    try {
      box = await this.create();
      await this.write(box, files);
      entry = { box, key, source: { ...files }, expires: Date.now() + 540000 };
      this.sessions.set(key, entry);
      return entry;
    } catch (e) {
      await box?.kill().catch(() => {});
      throw e;
    } finally {
      this.creating.delete(key);
    }
  }
  async exclusive(user, id, operation) {
    const key = user + ":" + id;
    if (this.busy.has(key))
      throw new HttpError(
        409,
        "Sandbox sedang menjalankan operasi lain. Tunggu sampai selesai.",
      );
    this.busy.add(key);
    try {
      const expired = this.sessions.get(key);
      if (expired && expired.expires <= Date.now()) {
        try {
          await expired.box.kill();
        } catch (e) {
          if (Date.now() < expired.expires + 60000) throw e;
        }
        this.sessions.delete(key);
        await this.coordination?.releaseSlot(user, id);
      }
      await this.coordination?.acquireSlot(user, id);
      return await operation();
    } finally {
      if (!this.sessions.has(key))
        await this.coordination?.releaseSlot(user, id).catch(() => {});
      this.busy.delete(key);
    }
  }
  async execute(user, id, files, command) {
    const entry = await this.forProject(user, id, files);
    let result;
    try {
      result = await entry.box.commands.run(command, {
        cwd: root,
        timeoutMs: 90000,
      });
    } catch (e) {
      if (typeof e.exitCode === "number") result = e;
      else
        throw new HttpError(502, "Sandbox berhenti atau melewati batas waktu.");
    }
    const output = String(result.stdout || "") + String(result.stderr || "");
    assertNoSecrets(output);
    return { output: output.slice(-60000), exitCode: result.exitCode ?? 0 };
  }
  run(user, id, files, command) {
    return this.exclusive(user, id, () =>
      this.execute(user, id, files, command),
    );
  }
  snapshot(user, id) {
    return this.exclusive(user, id, () => this.readSnapshot(user, id));
  }
  async readSnapshot(user, id) {
    const entry = this.sessions.get(user + ":" + id);
    if (!entry || entry.expires < Date.now())
      throw new HttpError(
        409,
        "Belum ada sandbox aktif atau sesi telah kedaluwarsa.",
      );
    const script = `const fs=require('node:fs'),path=require('node:path');const result={};let size=0;function walk(dir,depth=0){if(depth>20)return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','build','.git','.cache'].includes(item.name)||/^\\.env(?:$|\\.)/.test(item.name))continue;const full=path.join(dir,item.name);if(item.isDirectory())walk(full,depth+1);else if(item.isFile()){const stat=fs.statSync(full);if(stat.size>262144)continue;const b=fs.readFileSync(full);if(b.includes(0))continue;const text=b.toString('utf8');if(text.includes('\\ufffd'))continue;size+=b.length;if(size>4000000||Object.keys(result).length>=200)throw Error('Snapshot exceeds limit');result[path.relative('${root}',full)]=text;}}}walk('${root}');console.log(JSON.stringify(result));`;
    let output;
    try {
      output = await entry.box.commands.run("node -e " + shellQuote(script), {
        timeoutMs: 20000,
      });
    } catch {
      throw new HttpError(
        422,
        "Snapshot sandbox terlalu besar atau tidak dapat dibaca.",
      );
    }
    const files = JSON.parse(output.stdout);
    validFiles(files);
    return {
      files,
      notice:
        "File biner, node_modules, dist, secrets, dan file >256 KB tidak diimpor.",
    };
  }
  install(user, id, files, spec, remove = false) {
    return this.exclusive(user, id, async () => {
      if (!packageSpec.test(spec) || spec.length > 180)
        throw new HttpError(400, "Nama atau versi paket tidak valid.");
      const result = await this.execute(
        user,
        id,
        files,
        `npm ${remove ? "uninstall --ignore-scripts" : "install --ignore-scripts"} -- ${shellQuote(spec)}`,
      );
      if (result.exitCode !== 0) return { ...result, files: {} };
      const manifest = await this.sessions
        .get(user + ":" + id)
        .box.files.read(root + "/package.json");
      const changed = validFiles({ "package.json": manifest });
      return { ...result, files: changed };
    });
  }
  async waitForHTTP(box, port) {
    // Readiness is checked INSIDE the isolated sandbox; never probe an arbitrary user URL from our server.
    const script = `const end=Date.now()+20000;(async()=>{while(Date.now()<end){try{const r=await fetch('http://127.0.0.1:${port}/',{signal:AbortSignal.timeout(1500)});await r.body?.cancel();if(r.ok)process.exit(0);}catch{}await new Promise(r=>setTimeout(r,250));}process.exit(1);})();`;
    try {
      const result = await box.commands.run("node -e " + shellQuote(script), {
        cwd: root,
        timeoutMs: 25000,
      });
      if (result.exitCode !== 0) throw new Error("Not ready");
    } catch {
      throw new HttpError(
        502,
        "Server preview sandbox belum siap atau gagal dimulai. Tidak ada URL preview yang dikonfirmasi.",
      );
    }
  }
  preview(user, id, files) {
    return this.exclusive(user, id, async () => {
      const result = await this.execute(
        user,
        id,
        files,
        "npm install --ignore-scripts --no-audit --no-fund",
      );
      if (result.exitCode !== 0) return { ...result, url: null };
      const entry = this.sessions.get(user + ":" + id);
      if (entry.previewProcess) await entry.previewProcess.kill();
      entry.previewProcess = await entry.box.commands.run("npm run dev", {
        cwd: root,
        background: true,
      });
      try {
        await this.waitForHTTP(entry.box, 5173);
      } catch (e) {
        await entry.previewProcess.kill().catch(() => {});
        entry.previewProcess = null;
        throw e;
      }
      return {
        url: "https://" + entry.box.getHost(5173),
        notice:
          "HTTP preview merespons dari dalam sandbox. URL sementara dapat diakses pemegang tautan sampai sandbox dihentikan; akses dari jaringan browser Anda belum diuji.",
      };
    });
  }
  stop(user, id) {
    return this.exclusive(user, id, async () => {
      const key = user + ":" + id,
        entry = this.sessions.get(key);
      if (entry) await entry.box.kill();
      this.sessions.delete(key);
    });
  }
  async build(files, { audit = true } = {}) {
    const box = await this.create();
    try {
      await this.write(box, files);
      try {
        await box.commands.run(
          "npm install --ignore-scripts --no-audit --no-fund && npm run build",
          { cwd: root, timeoutMs: 240000 },
        );
      } catch {
        throw new HttpError(
          422,
          "Build sandbox gagal. Periksa dependensi dan kode sebelum menjalankan preview.",
        );
      }
      let report = null;
      if (audit) {
        await box.commands.run(
          "npx vite preview --host 0.0.0.0 --port 4173 --strictPort",
          { cwd: root, background: true },
        );
        try {
          await this.waitForHTTP(box, 4173);
          await box.commands.run(
            'lighthouse http://127.0.0.1:4173 --quiet --chrome-flags="--headless --no-sandbox --disable-dev-shm-usage" --output=json --output-path=/tmp/piwu-audit.json',
            { cwd: root, timeoutMs: 120000 },
          );
          const raw = JSON.parse(await box.files.read("/tmp/piwu-audit.json"));
          if (raw.runtimeError) throw new Error("Audit incomplete");
          report = {
            scores: Object.fromEntries(
              Object.entries(raw.categories).map(([k, v]) => [
                k,
                v.score === null ? null : Math.round(v.score * 100),
              ]),
            ),
            findings: Object.values(raw.audits)
              .filter((a) => typeof a.score === "number" && a.score < 1)
              .slice(0, 40)
              .map((a) => ({
                id: a.id,
                title: a.title,
                description: a.description,
                score: a.score,
              })),
          };
        } catch {
          throw new HttpError(
            503,
            "Lighthouse belum dapat berjalan. Template E2B harus menyediakan Chromium dan Lighthouse CLI. Tidak ada skor buatan yang ditampilkan.",
          );
        }
      }
      const zip = new JSZip();
      let total = 0,
        count = 0;
      async function add(dir, prefix = "") {
        for (const f of await box.files.list(dir)) {
          if (f.type === "dir") await add(f.path, prefix + f.name + "/");
          else if (f.type === "file") {
            const data = await box.files.read(f.path, { format: "bytes" });
            total += data.length;
            if (total > 25000000 || ++count > 500)
              throw new HttpError(
                413,
                "Hasil build melebihi 25 MB atau 500 file.",
              );
            zip.file(prefix + f.name, data);
          }
        }
      }
      await add(root + "/dist");
      if (!zip.file("index.html"))
        throw new HttpError(422, "Build tidak menghasilkan dist/index.html.");
      return { zip, report };
    } finally {
      await box.kill().catch(() => {});
    }
  }
}
