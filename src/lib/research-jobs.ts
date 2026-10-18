// The browser half of background research (the server half is
// `server/lib/research-jobs.mjs`): which runs this account started and has not
// collected yet, and which answers it already applied. Both lists live in local
// storage per account, because a reload must not lose the thread and must never
// show the same answer twice.
//
// Only *finished* answers survive a server restart. A run that died with the
// process cannot be recovered, so it is reported once instead of leaving the
// user waiting for something nobody is producing.
import { workspaceStorage } from "./local-storage";

const CLAIMED_KEY = "piwu-ai-research-jobs-v1";
const PENDING_KEY = "piwu-ai-research-pending-v1";
const CLAIMED_MAX = 40;
const PENDING_MAX = 20;
// A turn that was just sent is not on the server's job list for a moment, and a
// short-lived network hiccup returns an empty list: a pending run is only called
// lost after this much time, so the notice never fires on a healthy turn.
export const PENDING_GRACE_MS = 90_000;

export type PendingJob = { requestId: string; at: number };

const readList = (key: string): unknown[] => {
  try {
    const stored = workspaceStorage.getItem(key);
    const parsed =
      typeof stored === "string" && stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeList = (key: string, list: unknown[]) => {
  try {
    workspaceStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* memory only when storage is full or blocked */
  }
};

/** Answers already applied in this browser, so a second claim never repeats. */
export const readClaimedJobs = (scope: string): string[] =>
  readList(`${CLAIMED_KEY}:${scope}`).filter(
    (entry): entry is string => typeof entry === "string",
  );

export const rememberClaimedJob = (scope: string, requestId: string) => {
  const list = readClaimedJobs(scope).filter((x) => x !== requestId);
  list.push(requestId);
  writeList(`${CLAIMED_KEY}:${scope}`, list.slice(-CLAIMED_MAX));
};

/** Runs this browser started and has not collected yet, oldest first. */
export const readPendingJobs = (scope: string): PendingJob[] =>
  readList(`${PENDING_KEY}:${scope}`).filter((entry): entry is PendingJob => {
    const value = entry as PendingJob | null;
    return (
      Boolean(value) &&
      typeof value?.requestId === "string" &&
      typeof value?.at === "number"
    );
  });

export const rememberPendingJob = (scope: string, requestId: string) => {
  const list = readPendingJobs(scope).filter((x) => x.requestId !== requestId);
  list.push({ requestId, at: Date.now() });
  writeList(`${PENDING_KEY}:${scope}`, list.slice(-PENDING_MAX));
};

export const forgetPendingJob = (scope: string, requestId: string) => {
  writeList(
    `${PENDING_KEY}:${scope}`,
    readPendingJobs(scope).filter((x) => x.requestId !== requestId),
  );
};

/**
 * Runs this browser started that the server no longer knows about: the process
 * restarted before the answer was finished, or the job list was cleared. Both
 * are unrecoverable, so the caller may say so once.
 */
export const lostJobs = (
  pending: PendingJob[],
  known: Iterable<string>,
  now = Date.now(),
  graceMs = PENDING_GRACE_MS,
): string[] => {
  const present = new Set(known);
  return pending
    .filter(
      (entry) => !present.has(entry.requestId) && now - entry.at >= graceMs,
    )
    .map((entry) => entry.requestId);
};
