/**
 * Dashboard search: find a project by what it is *called* and by what is
 * *inside* it — file contents and the conversation around it.
 *
 * Two things this is careful about:
 *  - cost: a keystroke must not read every byte of every project, so each
 *    project gets a character budget and names are matched first;
 *  - honesty: when the budget ran out before the whole project could be read,
 *    that project is reported as not fully searched instead of being quietly
 *    left out of the results.
 */
import type { Project } from "../types";

/** Text read per project before the search gives up (a scene file alone can be 240k). */
export const SEARCH_CHARS_MAX = 1_500_000;
/** Below this, only names are matched: one letter would match everything anyway. */
export const SEARCH_MIN_CHARS = 2;

export interface SearchHit {
  project: Project;
  /** Where the match was found: "" (name/description), a file path, or "percakapan". */
  where: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Projects too big to read to the end that did not match in the part read. */
  notFullySearched: number;
}

export interface SearchScope {
  /** "all" or a project kind: webapp, mobile, roblox. */
  kind?: string;
  /** Only projects with a comment still open. */
  commentsOnly?: boolean;
}

export const openComments = (project: Project) =>
  (project.comments || []).filter((comment) => !comment.resolved).length;

/** One line of context around the match, trimmed to what a card can show. */
export function snippet(text: string, query: string, width = 80) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return "";
  const start = Math.max(0, at - 24);
  const end = Math.min(text.length, at + query.length + width);
  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}

/** What matched first is reported first: name, then a file, then the conversation. */
export function searchProjects(
  projects: Project[] | undefined,
  query: string,
  scope: SearchScope = {},
): SearchResult {
  const needle = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  let notFullySearched = 0;
  for (const project of projects || []) {
    if (
      scope.kind &&
      scope.kind !== "all" &&
      (project.kind || "webapp") !== scope.kind
    )
      continue;
    if (scope.commentsOnly && !openComments(project)) continue;
    if (!needle) {
      hits.push({ project, where: "" });
      continue;
    }
    const named = (project.name + " " + (project.description || ""))
      .toLowerCase()
      .includes(needle);
    if (named) {
      hits.push({ project, where: "" });
      continue;
    }
    // One letter would match half of every project, so below this only names
    // are matched — and an unmatched name is simply not a hit.
    if (needle.length < SEARCH_MIN_CHARS) continue;
    let budget = SEARCH_CHARS_MAX;
    let truncated = false;
    let found = "";
    for (const [path, text] of Object.entries(project.files || {})) {
      if (typeof text !== "string") continue;
      if (text.length > budget) {
        truncated = true;
        break;
      }
      budget -= text.length;
      if (text.toLowerCase().includes(needle)) {
        found = path;
        break;
      }
    }
    if (found) {
      hits.push({ project, where: found });
      continue;
    }
    const conversation = truncated
      ? ""
      : (project.messages || [])
          .map((message) => message.content || "")
          .join("\n");
    if (conversation && conversation.toLowerCase().includes(needle)) {
      hits.push({ project, where: "percakapan" });
      continue;
    }
    if (truncated) notFullySearched += 1;
  }
  return { hits, notFullySearched };
}
