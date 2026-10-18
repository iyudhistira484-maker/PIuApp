import { useMemo } from "react";
import { Link } from "react-router-dom";
import { History, Sparkles } from "lucide-react";
import {
  activityWhen,
  buildActivity,
  type ActivityItem,
} from "../../lib/dashboard/activity";
import type { Project } from "../../lib/types";

/**
 * The last handful of things that happened, across every project: "tadi aku
 * ngerjain apa ya?" answered without opening each project.
 *
 * It reads the version history (labels + timestamps) and creation times, and
 * says so — chat messages are not timestamped in this app, so they are not used
 * to pretend the feed is a conversation log.
 */
export default function ActivityFeed({ projects }: { projects: Project[] }) {
  const items = useMemo(() => buildActivity(projects, 8), [projects]);
  // The day is written once per group instead of once per row, so a busy
  // afternoon reads as a log rather than a column of "Hari ini".
  const groups = useMemo(() => {
    const found: {
      day: string;
      items: (ActivityItem & { clock: string })[];
    }[] = [];
    for (const item of items) {
      const [day, clock] = activityWhen(item.at).split(" · ");
      let group = found[found.length - 1];
      if (!group || group.day !== day) {
        group = { day, items: [] };
        found.push(group);
      }
      group.items.push({ ...item, clock });
    }
    return found;
  }, [items]);
  if (!items.length) return null;
  return (
    <section className="dashboard-activity" aria-label="Aktivitas terbaru">
      <header>
        <h2>
          <History size={14} /> Aktivitas terbaru
        </h2>
        <span className="activity-note">
          Dari riwayat project — pesan chat belum punya stempel waktu.
        </span>
      </header>
      {groups.map((group) => (
        <div className="activity-group" key={group.day}>
          <h3>{group.day}</h3>
          <ol>
            {group.items.map((item) => (
              <li key={item.id}>
                <Link to={`/project/${item.projectId}`}>
                  <span className="activity-when">{item.clock}</span>
                  <b>{item.label}</b>
                  <span className="activity-project">
                    {item.kind === "created" ? (
                      <Sparkles size={11} />
                    ) : (
                      <History size={11} />
                    )}{" "}
                    {item.projectName}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
