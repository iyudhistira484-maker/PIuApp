// Push project files to an existing GitHub repository with the Git Data API.
// The token never reaches PiwuApp's server: OAuth tokens come from the
// Supabase session in this browser, and a personal token lives in memory only.

export interface GithubTarget {
  owner: string;
  repo: string;
  branch: string;
  message: string;
}

export interface GithubFile {
  path: string;
  content: string;
}

export interface GithubPushResult {
  commit: string;
  url: string;
  files: number;
  skipped: number;
  createdBranch: boolean;
  emptyRepo: boolean;
}

export class GithubError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

const API = "https://api.github.com";
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const BINARY =
  /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|mp3|mp4|webm|wav|ogg|glb|gltf|fbx|obj|zip|gz|pdf|wasm)$/i;

/** Accepts `owner/repo` or a github.com URL; returns null for anything else. */
export function parseRepo(
  input: string,
): { owner: string; repo: string } | null {
  let value = input.trim();
  const url = value.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i,
  );
  if (url) value = url[1] + "/" + url[2].replace(/\.git$/i, "");
  const match = value.match(
    /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/,
  );
  if (!match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  if (
    !owner ||
    !repo ||
    [owner, repo].some(
      (part) => part === "." || part === ".." || part.includes(".."),
    )
  )
    return null;
  return { owner, repo };
}

export function validBranch(input: string): boolean {
  const branch = input.trim();
  return (
    /^[A-Za-z0-9._/-]{1,100}$/.test(branch) &&
    !branch.startsWith("-") &&
    !branch.startsWith("/") &&
    !branch.includes("..") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".lock")
  );
}

/**
 * Text files only. Binaries would need base64 blobs and are skipped, as are
 * dotenv files (they can hold real secrets) and oversized trees.
 */
export function selectFiles(
  files: Record<string, string>,
  limits = {
    files: MAX_FILES,
    fileBytes: MAX_FILE_BYTES,
    totalBytes: MAX_TOTAL_BYTES,
  },
): { files: GithubFile[]; skipped: number } {
  const selected: GithubFile[] = [];
  let skipped = 0;
  let bytes = 0;
  for (const [rawPath, content] of Object.entries(files || {})) {
    const path = String(rawPath).trim();
    const dotenv =
      /(^|\/)\.env(\.|$)/.test(path) && !path.endsWith(".env.example");
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("..") ||
      path.startsWith("node_modules/") ||
      path.startsWith(".git/") ||
      BINARY.test(path) ||
      dotenv ||
      typeof content !== "string" ||
      content.includes("\u0000")
    ) {
      skipped++;
      continue;
    }
    const size = new TextEncoder().encode(content).length;
    if (
      size > limits.fileBytes ||
      bytes + size > limits.totalBytes ||
      selected.length >= limits.files
    ) {
      skipped++;
      continue;
    }
    selected.push({ path, content });
    bytes += size;
  }
  return { files: selected, skipped };
}

function errorFor(status: number): string {
  if (status === 401) return "Token GitHub tidak valid atau sudah kedaluwarsa.";
  if (status === 403)
    return "GitHub menolak permintaan: izin token kurang atau batas laju tercapai.";
  if (status === 404)
    return "Repositori atau cabang tidak ditemukan, atau token tidak punya akses.";
  if (status === 409 || status === 422)
    return "Cabang berubah saat push. Muat ulang repositori lalu coba lagi.";
  if (status === 429) return "Batas laju GitHub tercapai. Coba lagi nanti.";
  return `GitHub menolak permintaan (HTTP ${status}).`;
}

/** Encodes each segment so a branch like `fitur/baru` keeps its slash. */
const refPath = (branch: string) =>
  branch.split("/").map(encodeURIComponent).join("/");

export async function pushToGithub(
  token: string,
  target: GithubTarget,
  files: Record<string, string>,
  fetcher: typeof fetch = fetch,
  limits?: Parameters<typeof selectFiles>[1],
): Promise<GithubPushResult> {
  if (!token.trim()) throw new GithubError("Token GitHub belum diisi.");
  const parsed = parseRepo(target.owner + "/" + target.repo);
  if (!parsed) throw new GithubError("Nama repositori tidak valid.");
  if (!validBranch(target.branch))
    throw new GithubError("Nama cabang tidak valid.");
  if (!target.message.trim() || target.message.length > 200)
    throw new GithubError("Pesan commit harus 1–200 karakter.");
  const selection = selectFiles(files, limits);
  if (selection.files.length === 0)
    throw new GithubError(
      "Tidak ada file teks yang bisa dikirim. File biner dan .env dilewati.",
    );

  const call = async (path: string, init?: RequestInit): Promise<any> => {
    let response: Response;
    try {
      response = await fetcher(API + path, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token.trim(),
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new GithubError(
        "Tidak dapat menghubungi GitHub. Periksa koneksi lalu coba lagi.",
      );
    }
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok)
      throw new GithubError(errorFor(response.status), response.status);
    return data;
  };

  const base = `/repos/${parsed.owner}/${parsed.repo}`;
  const info = await call(base);
  if (info?.archived)
    throw new GithubError(
      "Repositori diarsipkan dan tidak bisa menerima push.",
    );
  if (info?.permissions?.push === false)
    throw new GithubError("Token tidak punya izin menulis ke repositori ini.");

  const branch = target.branch.trim();
  let branchExisted = true;
  let parent: string | null = null;
  try {
    const ref = await call(`${base}/git/ref/heads/${refPath(branch)}`);
    parent = ref?.object?.sha || null;
  } catch (error) {
    if (!(error instanceof GithubError) || error.status !== 404) throw error;
    branchExisted = false;
  }

  let baseTree: string | null = null;
  if (parent) {
    const commit = await call(`${base}/git/commits/${parent}`);
    baseTree = commit?.tree?.sha || null;
  } else if (branch !== (info?.default_branch || "main")) {
    // A missing branch starts from the default branch when that one exists.
    try {
      const ref = await call(
        `${base}/git/ref/heads/${refPath(info?.default_branch || "main")}`,
      );
      parent = ref?.object?.sha || null;
      if (parent) {
        const commit = await call(`${base}/git/commits/${parent}`);
        baseTree = commit?.tree?.sha || null;
      }
    } catch (error) {
      if (!(error instanceof GithubError) || error.status !== 404) throw error;
    }
  }

  const treeBody: Record<string, unknown> = {
    tree: selection.files.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      content: file.content,
    })),
  };
  if (baseTree) treeBody.base_tree = baseTree;
  const tree = await call(`${base}/git/trees`, {
    method: "POST",
    body: JSON.stringify(treeBody),
  });

  const commitBody: Record<string, unknown> = {
    message: target.message.trim(),
    tree: tree.sha,
    parents: parent ? [parent] : [],
  };
  const commit = await call(`${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify(commitBody),
  });

  if (branchExisted) {
    await call(`${base}/git/refs/heads/${refPath(branch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
  } else {
    await call(`${base}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return {
    commit: commit.sha,
    url: `https://github.com/${parsed.owner}/${parsed.repo}/commit/${commit.sha}`,
    files: selection.files.length,
    skipped: selection.skipped,
    createdBranch: !branchExisted,
    emptyRepo: !parent,
  };
}
