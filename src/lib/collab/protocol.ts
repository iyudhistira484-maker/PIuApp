// Wire protocol for the collaborative text session. Everything here is pure:
// the React hook only moves messages between this session and the Realtime
// channel. Broadcast runs on the private project channel that already has a
// realtime.messages policy, so no migration is needed, and every payload is
// validated before it reaches the document.

import { CrdtDoc, CrdtLimitError, validOp, type CrdtOp } from "./doc";

export const PROTOCOL = 1;
export const EVENT = "crdt";
export const MAX_OPS_PER_MESSAGE = 1_000;
export const MAX_LOG = 20_000;
const MAX_PATH = 200;
const BASE = /^[0-9a-f]{16}[0-9a-z]{1,8}$/;
const SITE = /^[A-Za-z0-9_-]{1,24}$/;

export type CollabStatus = "off" | "joining" | "live" | "conflict" | "limit";

export type CollabMessage =
  | { v: 1; k: "hi"; base: string; site: string; path: string; n: number }
  | {
      v: 1;
      k: "mismatch";
      base: string;
      site: string;
      path: string;
      to: string;
    }
  | {
      v: 1;
      k: "state";
      base: string;
      site: string;
      path: string;
      to: string;
      part: number;
      parts: number;
      ops: CrdtOp[];
    }
  | {
      v: 1;
      k: "ops";
      base: string;
      site: string;
      path: string;
      ops: CrdtOp[];
    };

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    return null;
  return /[\u0000-\u001f\u007f]/.test(value) ? null : value;
}

function ops(value: unknown): CrdtOp[] | null {
  if (!Array.isArray(value) || value.length > MAX_OPS_PER_MESSAGE) return null;
  for (const op of value) if (!validOp(op)) return null;
  return value as CrdtOp[];
}

/** Returns null for anything malformed; a bad message never reaches the doc. */
export function parseMessage(raw: unknown): CollabMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.v !== PROTOCOL) return null;
  const base = typeof m.base === "string" && BASE.test(m.base) ? m.base : null;
  const site = typeof m.site === "string" && SITE.test(m.site) ? m.site : null;
  const path = str(m.path, MAX_PATH);
  if (!base || !site || !path) return null;
  if (m.k === "hi") {
    const n = Number(m.n);
    if (!Number.isInteger(n) || n < 1 || n > 2_000_000_000) return null;
    return { v: 1, k: "hi", base, site, path, n };
  }
  if (m.k === "mismatch") {
    const to = typeof m.to === "string" && SITE.test(m.to) ? m.to : null;
    return to ? { v: 1, k: "mismatch", base, site, path, to } : null;
  }
  if (m.k === "ops") {
    const list = ops(m.ops);
    return list ? { v: 1, k: "ops", base, site, path, ops: list } : null;
  }
  if (m.k === "state") {
    const to = typeof m.to === "string" && SITE.test(m.to) ? m.to : null;
    const part = Number(m.part),
      parts = Number(m.parts);
    const list = ops(m.ops);
    if (
      !to ||
      !list ||
      !Number.isInteger(part) ||
      !Number.isInteger(parts) ||
      parts < 1 ||
      parts > 100 ||
      part < 0 ||
      part >= parts
    )
      return null;
    return { v: 1, k: "state", base, site, path, to, part, parts, ops: list };
  }
  return null;
}

export interface ReceiveResult {
  reply?: CollabMessage[];
  /** Merged text, present only when remote ops changed what the user sees. */
  text?: string;
}

/**
 * One open file for one tab. It owns the document, the edits still needed by a
 * peer who joins later, and the honest status shown in the statusbar.
 */
export class CrdtSession {
  readonly doc: CrdtDoc;
  readonly site: string;
  readonly path: string;
  status: CollabStatus = "joining";
  private log: CrdtOp[] = [];
  private seen = new Set<string>();
  private sites = new Set<string>();
  private lastHello = new Map<
    string,
    { n: number; start: number; count: number }
  >();
  private sentState = new Set<string>();
  // Incremented on every hello. A reconnect starts a new round so both sides
  // exchange their history once, without an endless state ping-pong.
  private round = 0;

  constructor(path: string, text: string, site: string) {
    this.path = path;
    this.site = site;
    this.doc = new CrdtDoc(text, site);
  }

  hello(): CollabMessage {
    this.round++;
    return {
      v: 1,
      k: "hi",
      base: this.doc.base,
      site: this.site,
      path: this.path,
      n: this.round,
    };
  }

  /** Number of other tabs that have spoken to this session, plus itself. */
  writers(): number {
    return this.sites.size + 1;
  }

  private remember(applied: CrdtOp[]) {
    for (const op of applied) {
      const key = op.t === "ins" ? "i" + op.i : "d" + op.i;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.log.push(op);
    }
    if (this.log.length > MAX_LOG) {
      this.status = "limit";
      this.log = [];
    }
  }

  private stateReply(to: string): CollabMessage[] {
    this.sentState.add(this.round + ":" + to);
    return this.stateFor(to);
  }

  /** Every edit since the shared base, split so one message stays small. */
  stateFor(to: string): CollabMessage[] {
    const parts = Math.max(1, Math.ceil(this.log.length / 500));
    const out: CollabMessage[] = [];
    for (let part = 0; part < parts; part++) {
      out.push({
        v: 1,
        k: "state",
        base: this.doc.base,
        site: this.site,
        path: this.path,
        to,
        part,
        parts,
        ops: this.log.slice(part * 500, (part + 1) * 500),
      });
    }
    return out;
  }

  private stopped(): boolean {
    return this.status === "conflict" || this.status === "limit";
  }

  /** Turn the editor's new whole text into local ops and one broadcast. */
  applyLocal(next: string): { ops: CrdtOp[]; message?: CollabMessage } {
    if (this.stopped()) return { ops: [] };
    let applied: CrdtOp[] = [];
    try {
      applied = this.doc.localReplace(next);
    } catch (error) {
      if (error instanceof CrdtLimitError) this.status = "limit";
      else throw error;
      return { ops: [] };
    }
    this.remember(applied);
    if (!applied.length) return { ops: [] };
    if (this.status === "limit") return { ops: applied };
    return {
      ops: applied,
      message: {
        v: 1,
        k: "ops",
        base: this.doc.base,
        site: this.site,
        path: this.path,
        ops: applied,
      },
    };
  }

  receive(raw: unknown): ReceiveResult {
    const msg = parseMessage(raw);
    if (!msg || msg.site === this.site || msg.path !== this.path) return {};
    this.sites.add(msg.site);
    if (msg.base !== this.doc.base) {
      if (msg.k === "hi")
        return {
          reply: [
            {
              v: 1,
              k: "mismatch",
              base: this.doc.base,
              site: this.site,
              path: this.path,
              to: msg.site,
            },
          ],
        };
      // A peer started from different text: merging would silently corrupt it.
      if (this.status !== "limit") this.status = "conflict";
      return {};
    }
    // A conflicted or over-limit session must not pose as a valid source of
    // history for other tabs either.
    if (this.stopped()) return {};
    if (msg.k === "hi") {
      // Answer each new hello once. Reconnects bump `n`, so they are served
      // immediately, while a client replaying the same hello gets nothing.
      const now = Date.now();
      const previous = this.lastHello.get(msg.site);
      const record =
        !previous || now - previous.start > 10_000
          ? { n: 0, start: now, count: 0 }
          : previous;
      if (msg.n <= record.n || record.count >= 4) return {};
      record.n = msg.n;
      record.count++;
      this.lastHello.set(msg.site, record);
      return { reply: this.stateReply(msg.site) };
    }
    if (msg.k === "mismatch") {
      if (msg.to === this.site && this.status !== "limit")
        this.status = "conflict";
      return {};
    }
    if (msg.k === "state" && msg.to !== this.site) return {};
    if (this.stopped()) return {};
    const before = this.doc.text();
    let applied: CrdtOp[];
    try {
      applied = this.doc.applyMany(msg.ops);
    } catch (error) {
      if (error instanceof CrdtLimitError) {
        this.status = "limit";
        this.log = [];
        return {};
      }
      throw error;
    }
    this.remember(applied);
    if (this.status === "joining") this.status = "live";
    const after = this.doc.text();
    // If this peer sent us its history, it may never have seen ours (new tab,
    // reconnect, or a lost reply). Answer once per round; the other side then
    // stops because it already sent to us in this round.
    const key = this.round + ":" + msg.site;
    const reply = this.sentState.has(key)
      ? undefined
      : this.stateReply(msg.site);
    const changed = applied.length > 0 && after !== before;
    if (!changed && !reply) return {};
    return { ...(changed ? { text: after } : {}), ...(reply ? { reply } : {}) };
  }
}
