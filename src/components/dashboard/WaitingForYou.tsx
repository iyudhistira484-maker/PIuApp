import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { projectApi } from "../../services/api";
import { useStore } from "../../lib/store";
import { scopeFor } from "../../lib/cloud/types";
import {
  attentionItems,
  type AttentionItem,
  type CommentRow,
  type InviteRow,
  type ProjectSignals,
} from "../../lib/dashboard/attention";
import type { Project } from "../../lib/types";

/**
 * "Menunggu Anda": the things inside a project that stop until someone decides.
 *
 * Every item comes from a project endpoint that already existed (comments,
 * members/invites, the Studio bridge) — this panel only
 * gathers them in one place. Two rules keep it honest:
 *  - it checks a bounded number of the newest projects and says how many it
 *    checked, instead of pretending the list is complete;
 *  - a call that fails is never shown as "nothing to do": the footer reports how
 *    many projects could not be checked.
 */
const CHECKED_PROJECTS = 4;
const CHUNK = 2;
const SHOWN_ITEMS = 6;

interface Scan {
  phase: "idle" | "loading" | "ready";
  items: AttentionItem[];
  checked: number;
  unchecked: number;
  at?: number;
}

async function signalsFor(
  project: Project,
  syncPhase: string | undefined,
): Promise<{ signals: ProjectSignals; calls: number; failedCalls: number }> {
  let calls = 0;
  let failedCalls = 0;
  const grab = async <T,>(path: string) => {
    calls += 1;
    try {
      return await projectApi<T>(project.id, path);
    } catch {
      failedCalls += 1;
      return undefined;
    }
  };
  const [comments, members, studio] = await Promise.all([
    grab<{ comments?: CommentRow[] }>("comments"),
    grab<{ invites?: InviteRow[] }>("members"),
    grab<{ state?: string; queuedChanges?: number }>("studio"),
  ]);
  return {
    signals: {
      project: { id: project.id, name: project.name },
      comments: comments?.comments,
      invites: members?.invites,
      studio: studio || null,
      syncPhase,
    },
    calls,
    failedCalls,
  };
}

export default function WaitingForYou({ projects }: { projects: Project[] }) {
  const user = useStore((s) => s.user);
  const sync = useStore((s) => s.sync);
  const demo = scopeFor(user) === "demo";
  const newest = useMemo(
    () =>
      [...projects]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, CHECKED_PROJECTS),
    [projects],
  );
  const key = newest.map((project) => project.id).join(",");
  const [scan, setScan] = useState<Scan>({
    phase: "idle",
    items: [],
    checked: 0,
    unchecked: 0,
  });
  // Calls made and refused, so "no data at all" can be told apart from
  // "this one endpoint is down".
  const [calls, setCalls] = useState({ made: 0, refused: 0 });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (demo || !newest.length) {
      setScan({ phase: "ready", items: [], checked: 0, unchecked: 0 });
      return;
    }
    let live = true;
    setScan({ phase: "loading", items: [], checked: 0, unchecked: 0 });
    void (async () => {
      const items: AttentionItem[] = [];
      let checked = 0;
      let unchecked = 0;
      let made = 0;
      let refused = 0;
      for (let at = 0; at < newest.length; at += CHUNK) {
        const results = await Promise.all(
          newest
            .slice(at, at + CHUNK)
            .map((project) => signalsFor(project, sync[project.id]?.phase)),
        );
        if (!live) return;
        for (const result of results) {
          checked += 1;
          made += result.calls;
          refused += result.failedCalls;
          if (result.failedCalls) unchecked += 1;
          items.push(...attentionItems(result.signals));
        }
      }
      if (!live) return;
      setCalls({ made, refused });
      setScan({ phase: "ready", items, checked, unchecked, at: Date.now() });
    })();
    return () => {
      live = false;
    };
    // `key` keeps the scan tied to the projects it looked at, not to every
    // re-render of the store.
  }, [demo, key, round]);

  // Nothing to wait on yet: an empty panel would only be furniture.
  if (demo || !projects.length) return null;
  const shown = scan.items.slice(0, SHOWN_ITEMS);
  const time = scan.at
    ? new Date(scan.at).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return (
    <section className="dashboard-waiting" aria-label="Menunggu Anda">
      <header>
        <h2>Menunggu Anda</h2>
        {scan.phase === "ready" && scan.items.length > 0 && (
          <span className="waiting-count">{scan.items.length}</span>
        )}
        <button
          className="icon-button"
          aria-label="Periksa lagi"
          disabled={scan.phase === "loading"}
          onClick={() => setRound((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </header>
      {scan.phase === "loading" && (
        <p className="waiting-note">
          Memeriksa {newest.length} project terbaru…
        </p>
      )}
      {scan.phase === "ready" && !scan.items.length && (
        <p className="waiting-note">
          {scan.checked
            ? `Tidak ada yang menunggu di ${scan.checked} project terbaru.`
            : "Belum ada project untuk diperiksa."}
        </p>
      )}
      {!!scan.items.length && (
        <ul>
          {shown.map((item) => (
            <li key={item.id}>
              <Link to={item.link}>
                <b>{item.projectName}</b>
                <span>{item.title}</span>
                {item.detail && <small>{item.detail}</small>}
                <ArrowRight size={13} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {scan.items.length > shown.length && (
        <p className="waiting-note">
          +{scan.items.length - shown.length} lainnya di project yang sama —
          buka projectnya satu per satu.
        </p>
      )}
      {scan.phase === "ready" && !!scan.checked && (
        <p className="waiting-note">
          Diperiksa dari {scan.checked} project terbaru
          {time ? ` · ${time}` : ""}
          {scan.unchecked
            ? ` · ${scan.unchecked} project tidak bisa diperiksa (server menolak atau tidak menjawab)`
            : ""}
          .
        </p>
      )}
      {scan.phase === "ready" &&
        calls.made > 0 &&
        calls.refused === calls.made && (
          <p className="waiting-warn">
            <AlertTriangle size={12} /> Tidak bisa memeriksa sekarang: tidak ada
            jawaban dari server untuk project mana pun.
          </p>
        )}
    </section>
  );
}
