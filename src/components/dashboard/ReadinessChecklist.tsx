import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { scopeFor } from "../../lib/cloud/types";
import {
  pluginItem,
  readinessItems,
  readinessSummary,
  type Capabilities,
  type ReadyItem,
} from "../../lib/dashboard/readiness";
import { STUDIO_PLUGIN } from "../../../shared/studio.mjs";

/**
 * The checklist that explains a feature the user cannot find: it lists what the
 * server is configured for, in the words of what the user would do with it, and
 * names exactly what is missing when it is off.
 *
 * It stays a single line while everything is ready — a dashboard should not
 * shout about what already works. In demo mode it is not shown at all, because
 * there is no server to ask.
 */
export default function ReadinessChecklist({
  hasRobloxProject,
}: {
  hasRobloxProject: boolean;
}) {
  const user = useStore((s) => s.user);
  const demo = scopeFor(user) === "demo";
  const [capabilities, setCapabilities] = useState<Capabilities | undefined>();
  const [plugin, setPlugin] = useState<{ version?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (demo) return;
    let live = true;
    void fetch("/api/status")
      .then((response) => response.json())
      .then((data) => live && setCapabilities(data?.capabilities || {}))
      .catch(() => live && setCapabilities({}));
    return () => {
      live = false;
    };
  }, [demo]);

  useEffect(() => {
    if (demo || !hasRobloxProject) return;
    let live = true;
    void fetch("/api/studio/status")
      .then((response) => response.json())
      .then((data) => live && setPlugin(data?.plugin || {}))
      .catch(() => live && setPlugin({}));
    return () => {
      live = false;
    };
  }, [demo, hasRobloxProject]);

  const items = useMemo<ReadyItem[]>(
    () =>
      readinessItems(
        capabilities,
        hasRobloxProject
          ? [pluginItem({ plugin: plugin || undefined }, STUDIO_PLUGIN.version)]
          : [],
      ),
    [capabilities, hasRobloxProject, plugin],
  );
  const summary = readinessSummary(items);
  // Nothing is claimed before the server has answered.
  if (demo || !capabilities) return null;

  if (!summary.missing.length)
    return (
      <p className="dashboard-ready-all">
        <CheckCircle2 size={13} /> Semua fitur server siap ({summary.ready}/
        {summary.total}).
      </p>
    );

  if (hidden)
    return (
      <button className="dashboard-ready-warn" onClick={() => setHidden(false)}>
        <CircleSlash size={13} /> {summary.missing.length} fitur belum aktif —
        lihat apa yang kurang
      </button>
    );

  return (
    <section className="dashboard-readiness" aria-label="Kesiapan fitur">
      <header>
        <h2>{summary.missing.length} fitur belum aktif di server ini</h2>
        <span className="readiness-count">
          {summary.ready}/{summary.total} siap
        </span>
        <button
          className="icon-button"
          aria-label={open ? "Ringkas daftar" : "Lihat daftar lengkap"}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          className="icon-button"
          aria-label="Sembunyikan"
          onClick={() => setHidden(true)}
        >
          <CircleSlash size={14} />
        </button>
      </header>
      <ul>
        {items
          .filter((item) => open || !item.ready)
          .map((item) => (
            <li key={item.id} data-ready={item.ready}>
              {item.ready ? (
                <CheckCircle2 size={13} />
              ) : (
                <CircleSlash size={13} />
              )}
              <div>
                <b>{item.label}</b>
                <p>{item.ready ? item.hint : item.missing}</p>
              </div>
            </li>
          ))}
      </ul>
    </section>
  );
}
