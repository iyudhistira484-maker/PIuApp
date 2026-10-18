import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import { api, projectApi } from "../../services/api";
import { useStore } from "../../lib/store";
import { scopeFor } from "../../lib/cloud/types";
import {
  qualityOf,
  trendText,
  type AuditReport,
  type Quality,
} from "../../lib/dashboard/quality";
import type { Project } from "../../lib/types";

/**
 * "Kualitas project": the Lighthouse score of the projects that can have one,
 * with the movement since the previous audit.
 *
 * Two things this panel refuses to do: show a score it did not read (no data is
 * "Belum pernah diaudit", not a friendly zero), and offer an audit the server
 * cannot run (the button only appears when the sandbox capability is on and the
 * user may edit the project — audits cost 3 credits).
 */
const CHECKED = 3;

interface Row {
  quality: Quality | null;
  error: boolean;
}

export default function QualityPanel({ projects }: { projects: Project[] }) {
  const user = useStore((s) => s.user);
  const sync = useStore((s) => s.sync);
  const demo = scopeFor(user) === "demo";
  // Lighthouse only exists for Web App projects (the route answers 409 for the
  // rest), so a Roblox or mobile project never appears here.
  const candidates = useMemo(
    () =>
      projects
        .filter((project) => (project.kind || "webapp") === "webapp")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, CHECKED),
    [projects],
  );
  const key = candidates.map((project) => project.id).join(",");
  const [rows, setRows] = useState<Record<string, Row>>({});
  // `capabilities.audit` is the precise gate: a database, an E2B key and a
  // template with Chromium + Lighthouse. `sandbox` alone is not enough.
  const [auditReady, setAuditReady] = useState<boolean | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (demo) return;
    let live = true;
    void fetch("/api/status")
      .then((response) => response.json())
      .then((data) => live && setAuditReady(Boolean(data?.capabilities?.audit)))
      .catch(() => live && setAuditReady(false));
    return () => {
      live = false;
    };
  }, [demo]);

  useEffect(() => {
    if (demo || !candidates.length) return;
    let live = true;
    setRows({});
    void (async () => {
      const found: Record<string, Row> = {};
      for (const project of candidates) {
        try {
          const data = await projectApi<{ reports?: AuditReport[] }>(
            project.id,
            "audits",
          );
          found[project.id] = {
            quality: qualityOf(data.reports),
            error: false,
          };
        } catch {
          found[project.id] = { quality: null, error: true };
        }
        if (!live) return;
        setRows({ ...found });
      }
    })();
    return () => {
      live = false;
    };
  }, [demo, key, round]);

  async function runAudit(project: Project) {
    setBusy(project.id);
    setNote("");
    try {
      await projectApi(project.id, "audit", {}, "POST");
      setNote(`Audit ${project.name} selesai.`);
    } catch (error) {
      setNote(
        error instanceof Error
          ? `Audit gagal: ${error.message}`
          : "Audit gagal dijalankan.",
      );
    } finally {
      setBusy("");
      setRound((value) => value + 1);
    }
  }

  if (demo || !candidates.length) return null;
  return (
    <section className="dashboard-quality" aria-label="Kualitas project">
      <header>
        <h2>
          <Gauge size={13} /> Kualitas project
        </h2>
        <button
          className="icon-button"
          aria-label="Periksa lagi"
          disabled={!Object.keys(rows).length}
          onClick={() => setRound((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </header>
      <ul>
        {candidates.map((project) => {
          const row = rows[project.id];
          const entry = sync[project.id];
          const role = entry?.role;
          const mayAudit = role === "Owner" || role === "Editor";
          // The audit route builds from the copy on the server, so an unsynced
          // project would be audited in an older revision (or refused). Wait for
          // the sync instead of offering a button that answers with an error.
          const synced = !entry?.phase || entry.phase === "synced";
          return (
            <li key={project.id}>
              <div className="quality-head">
                <Link to={`/project/${project.id}`}>{project.name}</Link>
                {row?.error && (
                  <span className="quality-note">tidak terbaca</span>
                )}
                {!row && <span className="quality-note">memeriksa…</span>}
                {row?.quality && (
                  <span className={"quality-score tone-" + row.quality.tone}>
                    {row.quality.latest === null ? (
                      "Belum pernah diaudit"
                    ) : (
                      <>
                        {row.quality.latest}
                        <small>/100</small> · {row.quality.label}
                      </>
                    )}
                  </span>
                )}
              </div>
              {row?.quality && (
                <p className="quality-note">
                  {row.quality.latest === null
                    ? "Jalankan audit untuk melihat skor pertama."
                    : [
                        trendText(row.quality),
                        row.quality.parts
                          .map((part) => `${part.key} ${part.score}`)
                          .join(" · "),
                        row.quality.findings
                          ? `${row.quality.findings} temuan`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" — ")}
                </p>
              )}
              {mayAudit && !synced && (
                <p className="quality-note">
                  Menunggu tersinkron ke cloud — audit memakai versi terakhir di
                  server.
                </p>
              )}
              {mayAudit && synced && auditReady && (
                <button
                  className="button button-outline quality-button"
                  disabled={busy === project.id}
                  onClick={() => void runAudit(project)}
                >
                  <ShieldCheck size={12} />
                  {busy === project.id
                    ? "Menjalankan audit… (3 kredit)"
                    : row?.quality?.latest === null
                      ? "Audit sekarang (3 kredit)"
                      : "Audit ulang (3 kredit)"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {note && <p className="waiting-note">{note}</p>}
      {auditReady === false && (
        <p className="waiting-note">
          Audit Lighthouse belum aktif di server ini (butuh sandbox E2B dengan
          template Chromium + Lighthouse), jadi tombolnya tidak ditampilkan.
        </p>
      )}
      {Object.values(rows).some((row) => row.error) && (
        <p className="waiting-warn">
          Sebagian skor tidak bisa dibaca dari server.
        </p>
      )}
    </section>
  );
}
