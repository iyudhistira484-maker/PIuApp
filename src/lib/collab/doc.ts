// A small sequence CRDT for plain text. It is deliberately not a full Yjs
// implementation: every character is an immutable node with a unique id and a
// left-neighbour origin, concurrent inserts at the same origin are ordered
// deterministically by (counter, site), and deletes leave tombstones. Two tabs
// that start from the same saved text can therefore merge edits in any order.
//
// Limits are honest, not aspirational: CRDT is active only for files below
// MAX_TEXT and stops instead of silently dropping characters. Larger files keep
// using revision sync. No state is persisted; the merged text is saved through
// the normal project sync path.

export type CrdtOp =
  { t: "ins"; i: string; o: string; c: string } | { t: "del"; i: string };

interface CrdtNode {
  id: string;
  ch: string;
  origin: string;
  deleted: boolean;
}

export const MAX_TEXT = 30_000;
export const MAX_NODES = 60_000;
const ID = /^[A-Za-z0-9_-]{1,24}:[0-9a-z]{1,8}$/;

export class CrdtLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrdtLimitError";
  }
}

function fnv(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Stable id for the text a document was seeded from. */
export function baseId(text: string): string {
  return (
    fnv(text, 2_166_136_261) +
    fnv(text, 2_246_822_507) +
    text.length.toString(36)
  );
}

/** Base nodes use the same ids on every tab that starts from the same text. */
export function baseSite(text: string): string {
  return "b" + baseId(text);
}

function splitId(id: string): [string, number] | null {
  const at = id.lastIndexOf(":");
  if (at < 1) return null;
  const counter = Number.parseInt(id.slice(at + 1), 36);
  if (!Number.isFinite(counter) || counter < 0) return null;
  return [id.slice(0, at), counter];
}

/** Ascending: lower counter first, then site name. Descendants sort in reverse. */
export function compareIds(a: string, b: string): number {
  const left = splitId(a),
    right = splitId(b);
  if (!left || !right) return a < b ? -1 : a > b ? 1 : 0;
  if (left[1] !== right[1]) return left[1] - right[1];
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

export function validOp(value: unknown): value is CrdtOp {
  if (!value || typeof value !== "object") return false;
  const op = value as Partial<CrdtOp> & {
    i?: unknown;
    o?: unknown;
    c?: unknown;
  };
  if (op.t === "del") return typeof op.i === "string" && ID.test(op.i);
  return (
    op.t === "ins" &&
    typeof op.i === "string" &&
    ID.test(op.i) &&
    typeof op.o === "string" &&
    (op.o === "" || ID.test(op.o)) &&
    typeof op.c === "string" &&
    op.c.length === 1
  );
}

export class CrdtDoc {
  readonly base: string;
  readonly site: string;
  private nodes = new Map<string, CrdtNode>();
  private children = new Map<string, string[]>();
  private pending: CrdtOp[] = [];
  private counter: number;
  private cachedText: string | null = null;
  private cachedIds: string[] | null = null;

  constructor(text: string, site: string) {
    if (text.length > MAX_TEXT)
      throw new CrdtLimitError(
        `CRDT hanya untuk file sampai ${MAX_TEXT.toLocaleString("id-ID")} karakter.`,
      );
    this.base = baseId(text);
    this.site = site;
    const base = baseSite(text);
    let previous = "";
    for (let i = 0; i < text.length; i++) {
      const id = base + ":" + i.toString(36);
      this.addNode({ id, ch: text[i], origin: previous, deleted: false });
      previous = id;
    }
    this.counter = text.length + 1;
  }

  private kids(origin: string): string[] {
    let list = this.children.get(origin);
    if (!list) {
      list = [];
      this.children.set(origin, list);
    }
    return list;
  }

  private addNode(node: CrdtNode) {
    if (this.nodes.size >= MAX_NODES)
      throw new CrdtLimitError(
        "Batas riwayat CRDT tercapai. Simpan lalu muat ulang file.",
      );
    this.nodes.set(node.id, node);
    const list = this.kids(node.origin);
    list.push(node.id);
    list.sort((a, b) => compareIds(b, a));
    const parsed = splitId(node.id);
    if (parsed && parsed[1] >= this.counter) this.counter = parsed[1] + 1;
    this.cachedText = null;
    this.cachedIds = null;
  }

  private nextId(): string {
    return this.site + ":" + (this.counter++).toString(36);
  }

  private tryApply(op: CrdtOp): "ok" | "wait" | "dup" {
    if (op.t === "ins") {
      if (this.nodes.has(op.i)) return "dup";
      if (op.o !== "" && !this.nodes.has(op.o)) return "wait";
      this.addNode({ id: op.i, ch: op.c, origin: op.o, deleted: false });
      return "ok";
    }
    const node = this.nodes.get(op.i);
    if (!node) return "wait";
    if (node.deleted) return "dup";
    node.deleted = true;
    this.cachedText = null;
    this.cachedIds = null;
    return "ok";
  }

  /** Applies remote ops and returns the ones that were new, in arrival order. */
  applyMany(ops: CrdtOp[]): CrdtOp[] {
    const applied: CrdtOp[] = [];
    for (const op of ops) {
      const result = this.tryApply(op);
      if (result === "ok") applied.push(op);
      else if (result === "wait") this.pending.push(op);
    }
    let progress = true;
    while (progress && this.pending.length) {
      progress = false;
      const waiting = this.pending;
      this.pending = [];
      for (const op of waiting) {
        const result = this.tryApply(op);
        if (result === "ok") {
          applied.push(op);
          progress = true;
        } else if (result === "wait") this.pending.push(op);
      }
    }
    return applied;
  }

  private traverse(includeDeleted: boolean): string[] {
    const out: string[] = [];
    const stack = [...this.kids("")].reverse();
    while (stack.length) {
      const id = stack.pop()!;
      const node = this.nodes.get(id);
      if (!node) continue;
      if (includeDeleted || !node.deleted) out.push(id);
      const list = this.kids(id);
      for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
    }
    return out;
  }

  text(): string {
    if (this.cachedText !== null) return this.cachedText;
    let out = "";
    for (const id of this.traverse(false)) out += this.nodes.get(id)!.ch;
    this.cachedText = out;
    return out;
  }

  visibleIds(): string[] {
    if (this.cachedIds !== null) return this.cachedIds;
    this.cachedIds = this.traverse(false);
    return this.cachedIds;
  }

  /**
   * Turns a whole-text replacement into local ops. The editor passes the text
   * after a change; one common-prefix/suffix edit is enough for typing, paste,
   * delete and undo, and keeps the broadcast small.
   */
  localReplace(next: string): CrdtOp[] {
    const old = this.text();
    if (old === next) return [];
    if (next.length > MAX_TEXT)
      throw new CrdtLimitError(
        `CRDT hanya untuk file sampai ${MAX_TEXT.toLocaleString("id-ID")} karakter.`,
      );
    let prefix = 0;
    const max = Math.min(old.length, next.length);
    while (prefix < max && old[prefix] === next[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < old.length - prefix &&
      suffix < next.length - prefix &&
      old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
    )
      suffix++;
    const oldEnd = old.length - suffix;
    const ids = this.visibleIds();
    const ops: CrdtOp[] = [];
    for (let i = oldEnd - 1; i >= prefix; i--) {
      const id = ids[i];
      if (!id) continue;
      const node = this.nodes.get(id);
      if (!node || node.deleted) continue;
      node.deleted = true;
      ops.push({ t: "del", i: id });
    }
    if (ops.length) {
      this.cachedText = null;
      this.cachedIds = null;
    }
    let origin = prefix > 0 ? ids[prefix - 1] || "" : "";
    const middle = next.slice(prefix, next.length - suffix);
    for (let i = 0; i < middle.length; i++) {
      const id = this.nextId();
      this.addNode({ id, ch: middle[i], origin, deleted: false });
      ops.push({ t: "ins", i: id, o: origin, c: middle[i] });
      origin = id;
    }
    return ops;
  }

  /** Number of live + tombstoned characters, exposed for tests and limits. */
  size(): number {
    return this.nodes.size;
  }
}
