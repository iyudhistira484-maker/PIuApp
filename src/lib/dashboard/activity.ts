/**
 * "Aktivitas terbaru": what actually happened across projects, newest first.
 *
 * Where the data comes from, honestly: every project keeps its version history
 * (`versions[]` with a label and a timestamp) and a creation time. Chat messages
 * carry no timestamp in this app, so an activity feed built from them would be
 * guessing — this one is built from the history instead, and says so in the UI.
 */
import type { Project } from "../types";

export type ActivityKind = "created" | "version";

export interface ActivityItem {
  id: string;
  projectId: string;
  projectName: string;
  kind: ActivityKind;
  label: string;
  at: number;
}

export function buildActivity(
  projects: Project[] | undefined,
  limit = 8,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const project of projects || []) {
    const base = {
      projectId: project.id,
      projectName: project.name,
    };
    const versions = project.versions || [];
    versions.forEach((version, index) => {
      if (!version?.at) return;
      // Creating a project writes both a first version and `createdAt` with the
      // same label. The creation row below already says this; keeping both
      // doubled every new project in the feed.
      if (
        version.label === "Project dibuat" &&
        project.createdAt &&
        Math.abs(version.at - project.createdAt) < 60_000
      )
        return;
      items.push({
        ...base,
        // A version id may be missing in old data; the index keeps it unique.
        id: `${project.id}:v:${version.id || index}`,
        kind: "version",
        label: version.label || "Perubahan disimpan",
        at: version.at,
      });
    });
    if (project.createdAt)
      items.push({
        ...base,
        id: `${project.id}:created`,
        kind: "created",
        label: "Project dibuat",
        at: project.createdAt,
      });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}

const startOfDay = (at: number) => {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** "Hari ini · 14:05", "Kemarin · 09:20", "12 Okt · 18:40". */
export function activityWhen(at: number, now = Date.now()) {
  const time = new Date(at).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86400000);
  if (days <= 0) return `Hari ini · ${time}`;
  if (days === 1) return `Kemarin · ${time}`;
  const date = new Date(at).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
  return `${date} · ${time}`;
}
