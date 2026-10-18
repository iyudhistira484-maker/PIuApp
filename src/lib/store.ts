import { projectFiles, type ProjectKind } from "./project-kinds";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { workspaceStorage } from "./local-storage";
import { starterFiles, templates } from "./templates";
import type { Project, User, Message, SavedPrompt } from "./types";
import { emptyCache, scopeFor } from "./cloud/types";
import type {
  Connection,
  CloudProject,
  SyncEntry,
  WorkspaceCache,
} from "./cloud/types";
import { reconcile, acknowledge, synced } from "./cloud/reconcile";
import type { PersistedWorkspace } from "./cloud/persistence";
import { normalizePersisted, persistedWorkspace } from "./cloud/persistence";
const uid = () => crypto.randomUUID();
export interface Store {
  user: User | null;
  projects: Project[];
  prompts: SavedPrompt[];
  pendingPrompt: string;
  pendingProjectId: string;
  pendingMode: "Builder" | "Plan";
  pendingKind: ProjectKind;
  toast: string;
  workspaces: Record<string, WorkspaceCache>;
  sync: Record<string, SyncEntry>;
  deleted: WorkspaceCache["deleted"];
  connection: Connection;
  authReady: boolean;
  setUser: (u: User | null) => void;
  setAuthReady: (ready: boolean) => void;
  setPending: (s: string, m?: "Builder" | "Plan", kind?: ProjectKind) => void;
  createProject: (
    prompt: string,
    template?: string,
    kind?: ProjectKind,
  ) => string;
  /**
   * Puts a project from a backup file into the workspace, under a fresh id.
   * Restores never overwrite: a damaged backup cannot take existing work with it.
   */
  importProject: (data: Project, name: string) => string;
  updateProject: (id: string, data: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  duplicateProject: (id: string) => string;
  writeFile: (id: string, path: string, content: string) => void;
  applyFiles: (
    id: string,
    files: Record<string, string>,
    label: string,
  ) => void;
  restoreVersion: (id: string, versionId: string) => void;
  addMessage: (id: string, message: Message) => void;
  savePrompt: (p: Omit<SavedPrompt, "id">) => void;
  removePrompt: (id: string) => void;
  notify: (text: string) => void;
  setConnection: (connection: Connection) => void;
  mergeRemote: (scope: string, remote: CloudProject[]) => void;
  markSync: (scope: string, id: string, data: Partial<SyncEntry>) => void;
  acknowledgeSave: (scope: string, sent: Project, remote: CloudProject) => void;
  acknowledgeDelete: (scope: string, id: string) => void;
  restoreFailedDelete: (
    scope: string,
    id: string,
    error: string,
    conflict: boolean,
  ) => void;
  importDemoProjects: (ids: string[]) => number;
  resolveConflict: (id: string, choice: "cloud" | "fork") => void;
}
const cacheOf = (s: Store): WorkspaceCache => ({
  projects: s.projects,
  prompts: s.prompts,
  sync: s.sync,
  deleted: s.deleted,
});
const pending = (s: Store, id: string) =>
  scopeFor(s.user) === "demo"
    ? s.sync
    : {
        ...s.sync,
        [id]: {
          ...(s.sync[id] || { revision: 0, role: "Owner" as const }),
          phase:
            s.sync[id]?.phase === "conflict"
              ? ("conflict" as const)
              : ("pending" as const),
        },
      };
export const useStore = create<Store>()(
  persist<Store, [], [], PersistedWorkspace>(
    (set, get) => ({
      user: null,
      ...emptyCache(),
      workspaces: {},
      pendingPrompt: "",
      pendingProjectId: "",
      pendingMode: "Builder",
      pendingKind: "webapp",
      toast: "",
      connection: { phase: "local" },
      authReady: false,
      setAuthReady: (authReady) => set({ authReady }),
      setUser: (user) => {
        const state = get();
        const from = scopeFor(state.user),
          to = scopeFor(user);
        if (from === to) {
          set({ user });
          return;
        }
        const workspaces = { ...state.workspaces, [from]: cacheOf(state) };
        const cache = workspaces[to] || emptyCache();
        set({
          ...cache,
          workspaces,
          user,
          ...(from.startsWith("account:")
            ? { pendingPrompt: "", pendingProjectId: "" }
            : {}),
          connection: { phase: to === "demo" ? "local" : "loading" },
        });
      },
      setPending: (
        pendingPrompt,
        pendingMode = "Builder",
        pendingKind = "webapp",
      ) =>
        set({ pendingPrompt, pendingMode, pendingKind, pendingProjectId: "" }),
      createProject: (
        prompt,
        template,
        kind = template ? "webapp" : get().pendingKind,
      ) => {
        const t =
          templates.find((x) => x.id === template) ||
          templates.find((x) =>
            prompt.toLowerCase().includes(x.category.toLowerCase()),
          ) ||
          templates[0];
        const id = uid();
        const name = template
          ? t.name
          : prompt.replace(/^(buat(kan)?|bikin)\s+/i, "").slice(0, 40) ||
            "Project tanpa judul";
        const files = projectFiles(kind, t.id, name);
        set((s) => ({
          pendingProjectId: s.pendingPrompt ? id : s.pendingProjectId,
          projects: [
            {
              id,
              name,
              description: prompt,
              template: kind === "webapp" ? t.id : kind,
              kind,
              files,
              messages: [],
              versions: [
                {
                  id: uid(),
                  label: "Project dibuat",
                  files: { ...files },
                  at: Date.now(),
                },
              ],
              createdAt: Date.now(),
              updatedAt: Date.now(),
              comments: [],
            },
            ...s.projects,
          ],
          sync: pending(s, id),
        }));
        return id;
      },
      importProject: (data, name) => {
        const id = uid();
        set((s) => ({
          projects: [
            {
              ...data,
              id,
              name,
              versions: data.versions?.length ? data.versions : [],
              updatedAt: Date.now(),
            },
            ...s.projects,
          ],
          sync: pending(s, id),
        }));
        return id;
      },
      updateProject: (id, data) => {
        const state = get();
        if (!state.projects.some((p) => p.id === id)) return;
        if (state.sync[id]?.role === "Viewer") {
          state.notify(
            "Project ini hanya dapat dilihat. Minta akses Editor untuk mengubahnya.",
          );
          return;
        }
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? { ...p, ...data, id: p.id, updatedAt: Date.now() }
              : p,
          ),
          sync: pending(s, id),
        }));
      },
      deleteProject: (id) => {
        const state = get();
        const entry = state.sync[id];
        if (entry && entry.role !== "Owner") {
          state.notify("Hanya pemilik yang dapat menghapus project cloud.");
          return;
        }
        const project = state.projects.find((p) => p.id === id);
        if (!project) return;
        const sync = { ...state.sync };
        delete sync[id];
        set({
          projects: state.projects.filter((p) => p.id !== id),
          sync,
          deleted:
            scopeFor(state.user) === "demo"
              ? state.deleted
              : {
                  ...state.deleted,
                  [id]: { project, revision: entry?.revision || 0 },
                },
        });
      },
      duplicateProject: (id) => {
        const p = get().projects.find((p) => p.id === id);
        if (!p) return "";
        const newId = uid();
        set((s) => ({
          projects: [
            {
              ...structuredClone(p),
              id: newId,
              name: (p.name + " (salinan)").slice(0, 120),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            ...s.projects,
          ],
          sync: pending(s, newId),
        }));
        return newId;
      },
      writeFile: (id, path, content) => {
        const p = get().projects.find((p) => p.id === id);
        if (p && p.files[path] !== content)
          get().updateProject(id, { files: { ...p.files, [path]: content } });
      },
      applyFiles: (id, files, label) => {
        const p = get().projects.find((p) => p.id === id);
        if (!p) return;
        get().updateProject(id, {
          files: { ...p.files, ...files },
          versions: [
            ...p.versions,
            {
              id: uid(),
              label: "Sebelum: " + label,
              files: { ...p.files },
              at: Date.now(),
            },
          ].slice(-50),
        });
      },
      restoreVersion: (id, versionId) => {
        const p = get().projects.find((p) => p.id === id);
        const v = p?.versions.find((v) => v.id === versionId);
        if (p && v)
          get().updateProject(id, {
            files: { ...v.files },
            versions: [
              ...p.versions,
              {
                id: uid(),
                label: "Sebelum pemulihan",
                files: { ...p.files },
                at: Date.now(),
              },
            ].slice(-50),
          });
      },
      addMessage: (id, message) => {
        const p = get().projects.find((p) => p.id === id);
        if (p) get().updateProject(id, { messages: [...p.messages, message] });
      },
      savePrompt: (p) =>
        set((s) => ({ prompts: [{ ...p, id: uid() }, ...s.prompts] })),
      removePrompt: (id) =>
        set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),
      notify: (toast) => {
        set({ toast });
        setTimeout(() => {
          if (get().toast === toast) set({ toast: "" });
        }, 4000);
      },
      setConnection: (connection) => set({ connection }),
      mergeRemote: (scope, remote) => {
        if (scopeFor(get().user) !== scope) return;
        set(reconcile(cacheOf(get()), remote));
      },
      markSync: (scope, id, data) => {
        if (
          scopeFor(get().user) !== scope ||
          !get().projects.some((p) => p.id === id)
        )
          return;
        set((s) => ({
          sync: {
            ...s.sync,
            [id]: {
              ...(s.sync[id] || {
                revision: 0,
                role: "Owner",
                phase: "pending",
              }),
              ...data,
            },
          },
        }));
      },
      acknowledgeSave: (scope, sent, remote) => {
        if (scopeFor(get().user) === scope)
          set(acknowledge(cacheOf(get()), sent, remote));
      },
      acknowledgeDelete: (scope, id) => {
        if (scopeFor(get().user) !== scope) return;
        const deleted = { ...get().deleted };
        delete deleted[id];
        set({ deleted });
      },
      restoreFailedDelete: (scope, id, error, conflict) => {
        if (scopeFor(get().user) !== scope) return;
        const s = get(),
          d = s.deleted[id];
        if (!d) return;
        const deleted = { ...s.deleted };
        delete deleted[id];
        set({
          deleted,
          projects: [d.project, ...s.projects],
          sync: {
            ...s.sync,
            [id]: {
              revision: d.revision,
              role: "Owner",
              phase: "conflict",
              error: conflict
                ? "Project berubah sejak permintaan hapus. Tidak ada data cloud yang dihapus."
                : error,
            },
          },
        });
      },
      importDemoProjects: (ids) => {
        const s = get();
        if (scopeFor(s.user) === "demo") return 0;
        const originals = s.workspaces.demo?.projects || [];
        const selected = originals.filter((p) => ids.includes(p.id));
        const copies = selected.map((p) => ({
          ...structuredClone(p),
          id: uid(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
        set({
          projects: [...copies, ...s.projects],
          sync: {
            ...s.sync,
            ...Object.fromEntries(
              copies.map((p) => [
                p.id,
                { revision: 0, role: "Owner", phase: "pending" } as SyncEntry,
              ]),
            ),
          },
        });
        return copies.length;
      },
      resolveConflict: (id, choice) => {
        const s = get();
        const e = s.sync[id];
        if (!e || e.phase !== "conflict") return;
        const p = s.projects.find((p) => p.id === id);
        if (!p) return;
        const sync = { ...s.sync };
        delete sync[id];
        let projects = s.projects.filter((p) => p.id !== id);
        if (e.remote) {
          projects = [e.remote.project, ...projects];
          sync[id] = synced(e.remote);
        } else if (e.remote === undefined) {
          s.notify(
            "Muat ulang status cloud sebelum menyelesaikan konflik ini.",
          );
          return;
        }
        if (choice === "fork") {
          const copy = {
            ...structuredClone(p),
            id: uid(),
            name: (p.name + " (salinan lokal)").slice(0, 120),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          projects = [copy, ...projects];
          sync[copy.id] = { revision: 0, role: "Owner", phase: "pending" };
        }
        set({ projects, sync });
      },
    }),
    {
      name: "piwuapp-local-v1",
      storage: createJSONStorage(() => workspaceStorage),
      partialize: persistedWorkspace,
      merge: (stored, current) => ({
        ...current,
        ...normalizePersisted(stored),
        sync: {},
        deleted: {},
        connection: { phase: "local" },
        authReady: false,
      }),
    },
  ),
);
