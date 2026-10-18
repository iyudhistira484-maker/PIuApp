import { useStore } from "../store";
import type { ProjectRepository, Connection } from "./types";
import { RepositoryError, scopeFor } from "./types";
/** One serial queue per authenticated account. Never apply responses to another
 * account, acknowledge unsent edits, or silently overwrite a remote revision. */
export function startWorkspaceSync(
  repository: ProjectRepository,
  options: {
    debounce?: number;
    interval?: number;
    online?: () => boolean;
  } = {},
) {
  const scope = scopeFor(useStore.getState().user);
  const online =
    options.online ||
    (() => typeof navigator === "undefined" || navigator.onLine !== false);
  let disposed = false,
    applying = false,
    running = false,
    again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  const valid = () =>
    !disposed &&
    scope !== "demo" &&
    scopeFor(useStore.getState().user) === scope;
  const apply = (fn: () => void) => {
    if (!valid()) return;
    applying = true;
    try {
      fn();
    } finally {
      applying = false;
    }
  };
  const connection = (c: Connection) =>
    apply(() => useStore.getState().setConnection(c));
  const schedule = (delay = options.debounce ?? 1000) => {
    if (!valid()) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };
  async function pull(signal: AbortSignal) {
    const rows = await repository.list(signal);
    apply(() => useStore.getState().mergeRemote(scope, rows));
  }
  async function run() {
    if (!valid()) return;
    if (running) {
      again = true;
      return;
    }
    if (!online()) {
      connection({
        phase: "offline",
        error: "Anda sedang offline. Perubahan belum dikirim ke cloud.",
      });
      return;
    }
    running = true;
    again = false;
    let failed = false;
    active = new AbortController();
    const signal = AbortSignal.any([active.signal, AbortSignal.timeout(45000)]);
    if (!useStore.getState().connection.refreshedAt)
      connection({ phase: "loading" });
    try {
      await pull(signal);
      if (!valid()) return;
      for (const [id, deletion] of Object.entries(
        useStore.getState().deleted,
      )) {
        if (!valid()) return;
        try {
          await repository.delete(id, deletion.revision, signal);
          apply(() => useStore.getState().acknowledgeDelete(scope, id));
        } catch (e) {
          if (!valid()) return;
          const error =
            e instanceof RepositoryError
              ? e
              : new RepositoryError(
                  "Penghapusan cloud belum dikonfirmasi. Project dikembalikan ke daftar.",
                );
          apply(() =>
            useStore
              .getState()
              .restoreFailedDelete(
                scope,
                id,
                error.message,
                error.code === "conflict",
              ),
          );
          await pull(signal);
          throw error;
        }
      }
      for (const p of [...useStore.getState().projects]) {
        if (!valid()) return;
        const state = useStore.getState();
        const entry = state.sync[p.id];
        if (
          !entry ||
          entry.phase === "synced" ||
          entry.phase === "conflict" ||
          entry.role === "Viewer"
        )
          continue;
        // Capture the newest data immediately before the request, not the loop snapshot.
        const sent = structuredClone(
          state.projects.find((x) => x.id === p.id)!,
        );
        if (!sent) continue;
        apply(() =>
          useStore
            .getState()
            .markSync(scope, p.id, { phase: "saving", error: undefined }),
        );
        try {
          const saved = await repository.save(sent, entry.revision, signal);
          apply(() => useStore.getState().acknowledgeSave(scope, sent, saved));
        } catch (e) {
          if (!valid()) return;
          const error =
            e instanceof RepositoryError
              ? e
              : new RepositoryError(
                  "Sinkronisasi gagal. Edit masih tersimpan di perangkat ini.",
                );
          apply(() =>
            useStore.getState().markSync(scope, p.id, {
              phase:
                error.code === "conflict" || error.code === "permission"
                  ? "conflict"
                  : "error",
              error: error.message,
            }),
          );
          if (error.code === "conflict" || error.code === "permission")
            await pull(signal);
          throw error;
        }
      }
      connection({ phase: "ready", refreshedAt: Date.now() });
    } catch (e) {
      failed = true;
      if (valid())
        connection({
          phase: online() ? "error" : "offline",
          error:
            e instanceof RepositoryError
              ? e.message
              : "Cloud tidak merespons. Salinan lokal tetap tersedia; coba sinkronkan kembali.",
        });
    } finally {
      running = false;
      active = undefined;
      if (again && !failed && valid()) schedule();
    }
  }
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (
      !applying &&
      (state.projects !== previous.projects ||
        state.deleted !== previous.deleted)
    )
      schedule();
  });
  const interval = setInterval(() => void run(), options.interval ?? 60000);
  schedule(0);
  return {
    syncNow: run,
    stop: () => {
      disposed = true;
      active?.abort();
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribe();
    },
  };
}
export function requestCloudSync() {
  window.dispatchEvent(new Event("piwu:sync-now"));
}
