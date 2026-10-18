import test from "node:test";
import assert from "node:assert/strict";
import {
  CrdtDoc,
  CrdtLimitError,
  MAX_TEXT,
  baseId,
  compareIds,
  validOp,
} from "../src/lib/collab/doc";
import {
  CrdtSession,
  MAX_OPS_PER_MESSAGE,
  parseMessage,
} from "../src/lib/collab/protocol";
import { mapOffset, textDiff } from "../src/lib/collab/text";

// The CRDT is deliberately small: characters, tombstones, deterministic
// ordering. These tests pin the properties the editor relies on: two tabs that
// start from the same text converge no matter the order, and a tab that starts
// from different text is rejected instead of silently corrupting the file.

test("dokumen dari teks yang sama memakai id dasar yang sama", () => {
  const a = new CrdtDoc("hello", "uA"),
    b = new CrdtDoc("hello", "uB");
  assert.equal(a.base, b.base);
  assert.equal(baseId("hello"), baseId("hello"));
  assert.notEqual(baseId("hello"), baseId("hello "));
  assert.equal(a.text(), "hello");
});

test("satu suntingan lokal menjadi operasi kecil dan diterapkan di tab lain", () => {
  const a = new CrdtDoc("hello", "uA"),
    b = new CrdtDoc("hello", "uB");
  const ops = a.localReplace("heXllo");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].t, "ins");
  assert.deepEqual(b.applyMany(ops), ops);
  assert.equal(a.text(), "heXllo");
  assert.equal(b.text(), "heXllo");
});

test("dua tab yang mengetik bersamaan bertemu pada teks yang sama", () => {
  const a = new CrdtDoc("ab", "uA"),
    b = new CrdtDoc("ab", "uB");
  const fromA = a.localReplace("aXb");
  const fromB = b.localReplace("aYb");
  a.applyMany(fromB);
  b.applyMany(fromA);
  assert.equal(a.text(), b.text());
  assert.equal(a.text().length, 4);
  // Sibling inserts are ordered by id, not by arrival.
  assert.equal(a.text(), "aYXb");
});

test("hapus dan sisip bertemu walau urutannya dibalik", () => {
  const source = new CrdtDoc("abc", "uA");
  const ops = source.localReplace("aZZc");
  assert.equal(ops.length, 3);
  const target = new CrdtDoc("abc", "uB");
  target.applyMany([...ops].reverse());
  assert.equal(target.text(), "aZZc");
});

test("operasi yang belum punya induk menunggu, bukan hilang", () => {
  const a = new CrdtDoc("hello", "uA"),
    b = new CrdtDoc("hello", "uB");
  const first = a.localReplace("heXllo");
  const second = a.localReplace("heXyllo");
  // second refers to first; applying it alone must wait.
  b.applyMany(second);
  assert.equal(b.text(), "hello");
  b.applyMany(first);
  assert.equal(b.text(), "heXyllo");
});

test("teks kedua tab yang sama tetap konvergen setelah banyak suntingan", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const a = new CrdtDoc("", "uA"),
    b = new CrdtDoc("", "uB");
  for (let step = 0; step < 120; step++) {
    const target = random() < 0.5 ? a : b;
    const other = target === a ? b : a;
    const text = target.text();
    const at = Math.floor(random() * (text.length + 1));
    const next =
      random() < 0.35 && text.length > 0
        ? text.slice(0, at) + text.slice(Math.min(text.length, at + 1))
        : text.slice(0, at) +
          String.fromCharCode(97 + Math.floor(random() * 26)) +
          text.slice(at);
    const ops = target.localReplace(next);
    other.applyMany(ops);
    if (step % 17 === 0) {
      // Let the other side catch up in the opposite direction too.
      target.applyMany(other.localReplace(other.text()));
    }
  }
  a.applyMany(b.localReplace(b.text()));
  b.applyMany(a.localReplace(a.text()));
  assert.equal(a.text(), b.text());
});

test("batas file dan validasi operasi", () => {
  assert.throws(
    () => new CrdtDoc("x".repeat(MAX_TEXT + 1), "uA"),
    CrdtLimitError,
  );
  const doc = new CrdtDoc("ab", "uA");
  assert.throws(
    () => doc.localReplace("x".repeat(MAX_TEXT + 1)),
    CrdtLimitError,
  );
  assert.equal(validOp({ t: "ins", i: "uA:1", o: "", c: "x" }), true);
  assert.equal(validOp({ t: "del", i: "uA:1" }), true);
  assert.equal(validOp({ t: "ins", i: "uA:1", o: "", c: "xy" }), false);
  assert.equal(validOp({ t: "del", i: "nope" }), false);
  assert.equal(validOp(null), false);
  assert.ok(compareIds("uA:2", "uA:10") < 0);
});

test("pesan asing atau rusak ditolak sebelum menyentuh dokumen", () => {
  const good = {
    v: 1,
    k: "ops",
    base: "0123456789abcdef" + "1",
    site: "uA",
    path: "src/App.tsx",
    ops: [{ t: "ins", i: "uA:1", o: "", c: "x" }],
  };
  const base = "0123456789abcdef1";
  assert.ok(parseMessage(good));
  assert.equal(parseMessage({ ...good, v: 2 }), null);
  assert.equal(parseMessage({ ...good, path: "" }), null);
  assert.equal(parseMessage({ ...good, ops: [{ t: "ins" }] }), null);
  assert.equal(
    parseMessage({
      ...good,
      ops: Array.from({ length: MAX_OPS_PER_MESSAGE + 1 }, () => good.ops[0]),
    }),
    null,
  );
  assert.equal(parseMessage({ ...good, base: "zzz" }), null);
  assert.equal(
    parseMessage({
      v: 1,
      k: "state",
      base,
      site: "uA",
      path: "a",
      to: "uB",
      part: 1,
      parts: 1,
      ops: [],
    }),
    null,
  );
});

test("handshake mengirim riwayat dan sesi menjadi live", () => {
  const a = new CrdtSession("src/App.tsx", "hello", "uA");
  const b = new CrdtSession("src/App.tsx", "hello", "uB");
  const edits = a.applyLocal("heXllo");
  assert.ok(edits.message);
  const hello = b.hello();
  const reply = a.receive(hello).reply || [];
  assert.equal(reply.length, 1);
  const incoming = reply[0];
  assert.equal(incoming.k, "state");
  if (incoming.k !== "state") return;
  assert.equal(incoming.to, "uB");
  const result = b.receive(incoming);
  assert.equal(result.text, "heXllo");
  assert.equal(b.status, "live");
  assert.equal(b.doc.text(), "heXllo");
  assert.equal(a.writers(), 1 + 1); // b has spoken to a
  assert.equal(b.writers(), 1 + 1);
});

test("riwayat panjang dipecah menjadi beberapa pesan state", () => {
  const a = new CrdtSession("a.ts", "", "uA");
  a.applyLocal("x".repeat(1_050));
  const messages = a.stateFor("uB");
  assert.equal(messages.length, 3);
  const b = new CrdtSession("a.ts", "", "uB");
  for (const message of messages) b.receive(message);
  assert.equal(b.doc.text(), "x".repeat(1_050));
});

test("teks dasar berbeda ditolak, bukan digabung diam-diam", () => {
  const a = new CrdtSession("a.ts", "satu", "uA");
  const b = new CrdtSession("a.ts", "dua", "uB");
  const reply = a.receive(b.hello()).reply || [];
  assert.equal(reply.length, 1);
  assert.equal(reply[0].k, "mismatch");
  b.receive(reply[0]);
  assert.equal(b.status, "conflict");
  const attempt = b.applyLocal("dua!");
  assert.deepEqual(attempt.ops, []);
  assert.equal(attempt.message, undefined);
});

test("pesan untuk file atau tab lain diabaikan", () => {
  const a = new CrdtSession("a.ts", "hello", "uA");
  const b = new CrdtSession("b.ts", "hello", "uB");
  assert.deepEqual(b.receive(a.hello()), {});
  const c = new CrdtSession("a.ts", "hello", "uC");
  const edit = c.applyLocal("hello!");
  const broadcast = edit.message!;
  assert.deepEqual(b.receive(broadcast), {});
  // A state message addressed to someone else must not mark us live.
  const state = a.stateFor("uZ")[0];
  c.receive(state);
  assert.equal(c.status, "joining");
});

test("diff teks menyisakan bagian tengah dan memetakan kursor", () => {
  const diff = textDiff("hello world", "hello brave world");
  assert.ok(diff);
  assert.equal(diff.prefix, 6);
  assert.equal(diff.removed, 0);
  assert.equal(diff.inserted, "brave ");
  assert.equal(mapOffset(diff, 5), 5);
  assert.equal(mapOffset(diff, 6), 12);
  assert.equal(mapOffset(diff, 7), 13);
  assert.equal(mapOffset(diff, 11), 17);

  const removed = textDiff("abcdef", "abef");
  assert.ok(removed);
  assert.equal(removed.prefix, 2);
  assert.equal(removed.removed, 2);
  assert.equal(removed.inserted, "");
  assert.equal(mapOffset(removed, 3), 2);
  assert.equal(mapOffset(removed, 6), 4);
  assert.equal(textDiff("same", "same"), null);

  const replaced = textDiff("abc", "aZZc");
  assert.ok(replaced);
  assert.equal(replaced.removed, 1);
  assert.equal(replaced.inserted, "ZZ");
  assert.equal(mapOffset(replaced, 2), 3);

  const empty = textDiff("", "x");
  assert.ok(empty);
  assert.equal(empty.inserted, "x");
  assert.equal(mapOffset(empty, 0), 1);
});

test("reconnect menukar riwayat kedua arah, bukan satu arah saja", () => {
  const a = new CrdtSession("a.ts", "hello", "uA");
  const b = new CrdtSession("a.ts", "hello", "uB");
  const send = (to: CrdtSession, message: unknown) => to.receive(message);
  // First handshake, both directions.
  for (const message of send(b, a.hello()).reply || []) send(a, message);
  for (const message of send(a, b.hello()).reply || []) send(b, message);
  assert.equal(a.status, "live");
  assert.equal(b.status, "live");
  // Both type at the same time; let both messages drop on the floor.
  assert.ok(a.applyLocal("heXllo").message);
  assert.ok(b.applyLocal("heYllo").message);
  assert.equal(a.doc.text(), "heXllo");
  assert.equal(b.doc.text(), "heYllo");
  // A reconnects and re-announces. B answers with its history; A must answer
  // with its own, otherwise B never learns about "X".
  const first = send(b, a.hello());
  assert.ok(first.reply && first.reply.length > 0);
  let back: unknown[] = [];
  for (const message of first.reply) {
    const result = send(a, message);
    back = back.concat(result.reply || []);
  }
  assert.ok(back.length > 0, "A harus mengirim riwayatnya saat menerima state");
  for (const message of back) {
    const result = send(b, message);
    // B already sent its state to A in this round, so the exchange stops.
    assert.deepEqual(result.reply, undefined);
  }
  assert.equal(a.doc.text(), b.doc.text());
  assert.ok(a.doc.text().includes("X"));
  assert.ok(a.doc.text().includes("Y"));
});

test("emoji dan baris baru melewati protokol JSON tanpa rusak", () => {
  const a = new CrdtDoc("a\nb", "uA"),
    b = new CrdtDoc("a\nb", "uB");
  const ops = a.localReplace("a😀\nb");
  const wire = JSON.parse(JSON.stringify(ops));
  b.applyMany(wire);
  assert.equal(a.text(), "a😀\nb");
  assert.equal(b.text(), "a😀\nb");
});
