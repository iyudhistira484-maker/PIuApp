import test from "node:test";
import assert from "node:assert/strict";
import {
  displayName,
  initials,
  presenceColor,
  presencePeers,
  presenceSummary,
  presenceWhere,
} from "../src/lib/presence";

// What the UI may believe about a presence payload: only the newest tab per
// member, never the local user, never a line outside the editor, and never a
// name carrying control characters into a tooltip.

test("nama presence dibersihkan dan dibatasi", () => {
  assert.equal(displayName("  Rina\u0000  Putri \n"), "Rina Putri");
  assert.equal(displayName(""), "Anggota");
  assert.equal(displayName(42, "Rekan"), "Rekan");
  assert.equal(displayName("x".repeat(120)).length, 40);
  assert.equal(initials("Rina Putri"), "RP");
  assert.equal(initials("rina"), "R");
  assert.equal(initials("  "), "?");
});

test("warna presence stabil per anggota", () => {
  assert.equal(presenceColor("user-a"), presenceColor("user-a"));
  assert.match(presenceColor("user-a"), /^#[0-9a-f]{6}$/);
});

test("satu anggota dengan dua tab memakai payload terbaru", () => {
  const peers = presencePeers(
    {
      "user-b": [
        { name: "Bima", file: "src/Main.lua", line: 4, column: 2, at: 10 },
        { name: "Bima", file: "src/Game.lua", line: 18, column: 7, at: 25 },
      ],
    },
    "user-a",
  );
  assert.equal(peers.length, 1);
  assert.equal(peers[0].file, "src/Game.lua");
  assert.equal(peers[0].line, 18);
});

test("diri sendiri dan payload rusak diabaikan", () => {
  const peers = presencePeers(
    {
      "user-a": [{ name: "Saya", line: 3, at: 99 }],
      "user-c": [{ name: "Citra", line: -4, column: 0, at: "12" }],
      "user-d": [null as unknown as { name: string }],
    },
    "user-a",
  );
  assert.deepEqual(
    peers.map((p) => p.id),
    ["user-c"],
  );
  assert.equal(peers[0].line, 1);
  assert.equal(peers[0].column, 1);
  assert.equal(peers[0].at, 12);
});

test("label lokasi membedakan file aktif dan file lain", () => {
  const [peer] = presencePeers(
    { "user-b": [{ name: "Bima", file: "src/Main.lua", line: 9, column: 3 }] },
    "user-a",
  );
  assert.equal(presenceWhere(peer, "src/Main.lua"), "baris 9, kolom 3");
  assert.equal(presenceWhere(peer, "src/Game.lua"), "Main.lua");
  assert.equal(
    presenceWhere({ ...peer, file: "" }, "src/Game.lua"),
    "di project",
  );
});

test("ringkasan status jujur saat realtime mati", () => {
  const [peer] = presencePeers({ "user-b": [{ name: "Bima" }] }, "user-a");
  assert.equal(presenceSummary([], "live"), "Hanya Anda · realtime");
  assert.equal(presenceSummary([peer], "live"), "2 hadir · realtime");
  assert.equal(presenceSummary([], "off"), "");
  assert.equal(
    presenceSummary([], "degraded"),
    "Realtime terputus · polling aktif",
  );
});
