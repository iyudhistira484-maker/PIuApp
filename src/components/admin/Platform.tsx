import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, ShieldCheck } from "lucide-react";
import { api } from "../../services/api";
import { useStore } from "../../lib/store";
import { supabase } from "../../lib/supabase";
import "./platform.css";
type Message = { id: string; title: string; body: string; read: boolean };
type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  created_at: string;
};
const PlatformContext = createContext<{
  settings: Record<string, any>;
  broadcasts: Message[];
  error: string;
  notifications: NotificationRow[];
  unread: number;
  notificationsApplied: boolean;
  notificationsError: string;
  refresh: () => void;
  read: (id: string) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}>({
  settings: {},
  broadcasts: [],
  error: "",
  notifications: [],
  unread: 0,
  notificationsApplied: true,
  notificationsError: "",
  refresh: () => {},
  read: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
});
export const usePlatform = () => useContext(PlatformContext);
export function PlatformProvider({ children }: { children: ReactNode }) {
  const user = useStore((s) => s.user);
  const [state, setState] = useState({
    scope: user?.id,
    settings: {} as Record<string, any>,
    broadcasts: [] as Message[],
    error: "",
    notifications: [] as NotificationRow[],
    unread: 0,
    notificationsApplied: true,
    notificationsError: "",
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let dead = false;
    const controller = new AbortController();
    setState({
      scope: user?.id,
      settings: {},
      broadcasts: [],
      error: "",
      notifications: [],
      unread: 0,
      notificationsApplied: true,
      notificationsError: "",
    });
    let inFlight = false;
    async function load() {
      if (inFlight || dead) return;
      inFlight = true;
      let publicData: {
        settings: Record<string, any>;
        broadcasts: Message[];
      } | null = null;
      let broadcasts: Message[] = [];
      let error = "";
      let notifications: NotificationRow[] = [];
      let unread = 0;
      let notificationsApplied = true;
      let notificationsError = "";
      try {
        try {
          const data = await api<any>(
            "/public/site",
            undefined,
            "GET",
            AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
          );
          if (
            data &&
            typeof data.settings === "object" &&
            data.settings !== null &&
            !Array.isArray(data.settings) &&
            Array.isArray(data.broadcasts)
          ) {
            publicData = data;
            broadcasts = data.broadcasts;
          }
        } catch {
          // Landing content is optional. Preserve the last known public copy,
          // or use Landing's defaults, without a global failure/retry banner.
        }
        if (user && !user.demo && !dead) {
          try {
            const data = await api<{ broadcasts: Message[] }>(
              "/announcements",
              undefined,
              "GET",
              AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
            );
            if (!Array.isArray(data.broadcasts))
              throw new Error("Pengumuman member belum dapat dimuat.");
            broadcasts = data.broadcasts;
          } catch (e) {
            broadcasts = [];
            error =
              e instanceof Error
                ? e.message
                : "Pengumuman member belum dapat dimuat.";
          }
        }
        if (user && !user.demo && !dead) {
          try {
            const data = await api<{
              applied?: boolean;
              items?: NotificationRow[];
              unread?: number;
              notice?: string;
            }>(
              "/notifications",
              undefined,
              "GET",
              AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
            );
            if (data && Array.isArray(data.items)) {
              notifications = data.items
                .filter(
                  (n) =>
                    n &&
                    typeof n.id === "string" &&
                    typeof n.title === "string" &&
                    typeof n.body === "string",
                )
                .map((n) => ({
                  id: n.id,
                  kind: typeof n.kind === "string" ? n.kind : "system",
                  title: n.title,
                  body: n.body,
                  href: typeof n.href === "string" ? n.href : "",
                  read: Boolean(n.read),
                  created_at:
                    typeof n.created_at === "string" ? n.created_at : "",
                }));
              unread =
                typeof data.unread === "number"
                  ? Math.max(0, data.unread)
                  : notifications.filter((n) => !n.read).length;
              notificationsApplied = data.applied !== false;
              notificationsError =
                data.applied === false ? data.notice || "" : "";
            } else throw new Error("Notifikasi belum dapat dimuat.");
          } catch (e) {
            notificationsApplied = true;
            notificationsError =
              e instanceof Error ? e.message : "Notifikasi belum dapat dimuat.";
          }
        }
        if (!dead)
          setState((previous) => ({
            scope: user?.id,
            settings: publicData?.settings ?? previous.settings,
            broadcasts,
            error,
            notifications,
            unread,
            notificationsApplied,
            notificationsError,
          }));
      } finally {
        inFlight = false;
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => {
      dead = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [user?.id, user?.demo, revision]);
  // Realtime is an acceleration, never the only path: the 60-second poll above
  // also runs when Realtime is unavailable or the table is not published.
  useEffect(() => {
    if (!supabase || !user || user.demo) return;
    const channel = supabase
      .channel("piwu:notifications:" + user.id)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: "user_id=eq." + user.id,
        },
        () => setRevision((n) => n + 1),
      )
      .subscribe();
    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [user?.id, user?.demo]);
  return (
    <PlatformContext.Provider
      value={{
        ...(state.scope === user?.id
          ? state
          : {
              settings: {},
              broadcasts: [],
              error: "",
              notifications: [],
              unread: 0,
              notificationsApplied: true,
              notificationsError: "",
            }),
        refresh: () => setRevision((n) => n + 1),
        markRead: async (id) => {
          const account = useStore.getState().user?.id;
          await api("/notifications/" + id + "/read", {});
          if (account === useStore.getState().user?.id)
            setState((s) => {
              const item = s.notifications.find((n) => n.id === id);
              if (!item || item.read) return s;
              return {
                ...s,
                notifications: s.notifications.map((n) =>
                  n.id === id ? { ...n, read: true } : n,
                ),
                unread: Math.max(0, s.unread - 1),
              };
            });
        },
        markAllRead: async () => {
          const account = useStore.getState().user?.id;
          await api("/notifications/read-all", {});
          if (account === useStore.getState().user?.id)
            setState((s) => ({
              ...s,
              notifications: s.notifications.map((n) => ({
                ...n,
                read: true,
              })),
              unread: 0,
            }));
        },
        read: async (id) => {
          const account = useStore.getState().user?.id;
          await api("/announcements/" + id + "/read", {});
          if (account === useStore.getState().user?.id)
            setState((s) => ({
              ...s,
              broadcasts: s.broadcasts.map((b) =>
                b.id === id ? { ...b, read: true } : b,
              ),
            }));
        },
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}
export function PlatformNotices({
  showErrors = false,
}: {
  showErrors?: boolean;
}) {
  const { settings, broadcasts, error, refresh, read } = usePlatform();
  const user = useStore((s) => s.user);
  const [readError, setReadError] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    setReadError("");
    setBusy("");
  }, [user?.id]);
  return (
    <>
      {settings.maintenance && (
        <div className="platform-maintenance" role="status">
          {settings.maintenance_message}
        </div>
      )}
      {showErrors && error && (
        <div className="platform-announcements" role="status">
          {error} <button onClick={refresh}>Muat ulang informasi</button>
        </div>
      )}
      {broadcasts.length > 0 && (
        <details className="platform-announcements">
          <summary>
            Pengumuman PiwuApp · {broadcasts.length} pesan
            {user && !user.demo
              ? " · " +
                broadcasts.filter((b) => !b.read).length +
                " belum dibaca"
              : ""}
          </summary>
          {broadcasts.map((b) => (
            <article key={b.id}>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
              {user && !user.demo && (
                <button
                  disabled={b.read || !!busy}
                  onClick={async () => {
                    setReadError("");
                    setBusy(b.id);
                    try {
                      await read(b.id);
                    } catch (e) {
                      setReadError(
                        e instanceof Error
                          ? e.message
                          : "Gagal menandai dibaca.",
                      );
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  {b.read
                    ? "Sudah dibaca"
                    : busy === b.id
                      ? "Menyimpan…"
                      : "Tandai dibaca"}
                </button>
              )}
            </article>
          ))}
          {readError && <p role="alert">{readError}</p>}
        </details>
      )}
    </>
  );
}
export function NotificationBell({ dark = false }: { dark?: boolean }) {
  const {
    notifications,
    unread,
    notificationsApplied,
    notificationsError,
    markRead,
    markAllRead,
    refresh,
  } = usePlatform();
  const user = useStore((s) => s.user);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    setOpen(false);
    setBusy("");
    setError("");
  }, [user?.id]);
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [open]);
  if (!user || user.demo) return null;
  const label = "Notifikasi" + (unread > 0 ? ` (${unread} belum dibaca)` : "");
  return (
    <div className={"notif-wrap" + (dark ? " notif-dark" : "")}>
      <button
        className="icon-button notif-button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifikasi">
          <header>
            <strong>Notifikasi</strong>
            {unread > 0 && (
              <button
                disabled={!!busy}
                onClick={async () => {
                  setError("");
                  setBusy("all");
                  try {
                    await markAllRead();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Gagal menandai semua dibaca.",
                    );
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <CheckCheck size={14} /> Tandai semua dibaca
              </button>
            )}
          </header>
          {error && (
            <p className="notif-error" role="alert">
              {error}
            </p>
          )}
          {!notificationsApplied ? (
            <p className="notif-empty">
              {notificationsError || "Notifikasi server belum tersedia."}
            </p>
          ) : notifications.length === 0 ? (
            <p className="notif-empty">Belum ada notifikasi.</p>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id} className={n.read ? "" : "unread"}>
                  <Link
                    to={n.href || "/projects"}
                    onClick={() => {
                      setOpen(false);
                      if (!n.read) void markRead(n.id).catch(() => {});
                    }}
                  >
                    <span className="notif-kind" aria-hidden="true" />
                    <strong>{n.title}</strong>
                    <p>{n.body}</p>
                    <small>
                      {n.created_at
                        ? new Date(n.created_at).toLocaleString("id-ID", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : ""}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <footer>
            <button disabled={!!busy} onClick={() => refresh()}>
              Muat ulang
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
export function AdminLink() {
  const user = useStore((s) => s.user);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let dead = false;
    setAllowed(false);
    if (user && !user.demo)
      api("/admin/session")
        .then(() => {
          if (!dead) setAllowed(true);
        })
        .catch(() => {});
    return () => {
      dead = true;
    };
  }, [user?.id, user?.demo]);
  return allowed ? (
    <Link className="sidebar-settings" to="/admin">
      <ShieldCheck size={16} />
      Administrasi
    </Link>
  ) : null;
}
