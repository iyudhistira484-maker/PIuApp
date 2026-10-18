import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { realAccountFixture, loginRealFixture } from "./helpers-real";

test("project selector is integrated with composer, responsive and retains mobile choice across login", async ({
  page,
}) => {
  const fixture = await realAccountFixture(page, false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const selector = page.getByRole("group", { name: "Jenis project" });
  await expect(selector).toHaveCount(1);
  await page.screenshot({ path: ".artifacts/project-selector-desktop.png" });
  await selector
    .getByRole("radio", { name: "Aplikasi Mobile", exact: true })
    .check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".artifacts/project-selector-mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  expect(
    (await new AxeBuilder({ page }).include(".hero-section").analyze())
      .violations,
  ).toEqual([]);
  await page
    .getByLabel("Ceritakan ide aplikasi Anda")
    .fill("Aplikasi catatan mobile");
  await page
    .getByRole("button", { name: "Kirim ide dan buat project" })
    .click();
  await loginRealFixture(page);
  await expect(
    page.getByRole("heading", { name: "Aplikasi native · Expo" }),
  ).toBeVisible();
  await expect
    .poll(() => [...fixture.rows.values()][0]?.payload.kind)
    .toBe("mobile");
  const saved = [...fixture.rows.values()][0].payload;
  expect(saved.files["App.tsx"]).toContain("react-native");
  expect(saved.files["package.json"]).toContain('"expo"');
  expect(saved.files["src/App.tsx"]).toBeUndefined();
  expect(saved.files["lib/piwu.ts"]).toContain("/api/public/app/");
  await expect(
    page.getByRole("heading", { name: "Backend data", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("tertanam di bundle APK/IPA", { exact: false }),
  ).toBeVisible();
  await expect(
    page.locator('iframe[title="Live preview aplikasi Anda"]'),
  ).toHaveCount(0);
});

test("Roblox project: real scene editing, mesh export, Luau editor, bridge unavailable is honest", async ({
  page,
}) => {
  const fixture = await realAccountFixture(page, false);
  await loginRealFixture(page);
  await page
    .getByRole("button", { name: "Buat project pertama", exact: true })
    .click();
  await page.getByRole("radio", { name: /Roblox Game/ }).check();
  await page.getByPlaceholder("Buat game Roblox tentang…").fill("Pulau obby");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Roblox 3D Builder" }),
  ).toBeVisible();
  await expect
    .poll(() => [...fixture.rows.values()][0]?.payload.kind)
    .toBe("roblox");
  await page.getByRole("button", { name: "Balok", exact: true }).click();
  await page.getByLabel("Nama", { exact: true }).fill("Platform pertama");
  await page.getByLabel("Posisi X", { exact: true }).fill("6");
  await page
    .getByRole("button", { name: "Simpan properti", exact: true })
    .click();
  await expect(
    page
      .locator(".rb-explorer")
      .getByRole("button", { name: /Platform pertama/ }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        JSON.parse(
          [...fixture.rows.values()][0]?.payload.files["scene.roblox.json"] ||
            "{}",
        ).objects?.length,
    )
    .toBe(2);
  await page.getByRole("button", { name: "Mesh kosong", exact: true }).click();
  await page.getByLabel("Vertices mesh").fill("0 0 0\n1 0 0\n0 1 0\n0 0 1");
  await page.getByLabel("Faces mesh").fill("0 1 2\n0 1 3\n0 2 3\n1 2 3");
  await page
    .getByRole("button", { name: "Simpan properti", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor OBJ tersimpan" }).click();
  expect((await download).suggestedFilename()).toBe("piwu-mesh.obj");
  await page.screenshot({ path: ".artifacts/roblox-builder-desktop.png" });
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".code-tabs")).toContainText("Main.server.luau");
  await page
    .getByRole("group", { name: "Tampilan editor" })
    .getByRole("button", { name: "3D Builder", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hubungkan Studio", exact: true })
    .click();
  // What a user installs is the .rbxmx bundle: one Script whose Source is the
  // real plugin, with the version the panel advertises. The .luau next to it is
  // the manual fallback, and it must not drift from the bundle.
  const install = page.getByRole("link", {
    name: /Unduh plugin PiwuApp \.rbxmx · v\d/,
  });
  await expect(install).toHaveAttribute("href", "/plugins/PiwuStudio.rbxmx");
  const version = (await install.textContent())!.match(/v([\d.]+)/)![1];
  const bundle = await page.request.get("/plugins/PiwuStudio.rbxmx");
  expect(bundle.ok()).toBe(true);
  const xml = await bundle.text();
  expect(xml).toContain('<Item class="Script"');
  expect(xml).toContain('class="Script" referent="RBX0"');
  expect(xml).toContain(`local VERSION = "${version}"`);
  expect(xml).toContain("UpdateSourceAsync");
  const manual = await page.request.get("/plugins/PiwuStudio.luau");
  expect(manual.ok()).toBe(true);
  const source = await manual.text();
  expect(source).toContain("UpdateSourceAsync");
  expect(source).toContain(`local VERSION = "${version}"`);
  // The manual copy is raw Luau, not the XML bundle under another name.
  expect(source.startsWith("--!strict")).toBe(true);
  expect(source).not.toContain("</ProtectedString>");
  await page.getByRole("button", { name: "Buat token pasangan" }).click();
  await expect(page.locator(".rb-bridge").getByRole("alert")).toContainText(
    "belum dikonfigurasi",
  );
});

test("Studio bridge UI imports full snapshot, builds explicit changes and only queues after review", async ({
  page,
}) => {
  const fixture = await realAccountFixture(page, false);
  const snapshot = {
    version: 1,
    snapshotId: crypto.randomUUID(),
    placeId: "123",
    nodes: [
      {
        id: "root",
        parentId: "",
        name: "Workspace",
        className: "Workspace",
        properties: {},
      },
      {
        id: "floor",
        parentId: "root",
        name: "Floor",
        className: "Part",
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          size: [10, 1, 10],
          color: "#667766",
          anchored: true,
          shape: "Block",
        },
      },
    ],
  };
  let sent: any = null;
  await page.route("**/api/projects/*/studio", (r) =>
    r.fulfill({ json: { connected: true, state: "idle", snapshot } }),
  );
  await page.route("**/api/projects/*/studio/send", async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ json: { queued: true, id: sent.id } });
  });
  await loginRealFixture(page);
  await page
    .getByRole("button", { name: "Buat project pertama", exact: true })
    .click();
  await page.getByRole("radio", { name: /Roblox Game/ }).check();
  await page
    .getByPlaceholder("Buat game Roblox tentang…")
    .fill("Studio Terhubung");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await page
    .getByRole("button", { name: "Hubungkan Studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Impor snapshot Studio", exact: true })
    .click();
  await expect(page.locator(".rb-studio-tree")).toContainText("Workspace");
  await page
    .locator(".rb-studio-tree")
    .getByRole("button", { name: /Floor/ })
    .click();
  await page.getByLabel("Nama objek").fill("Panggung");
  await page.getByRole("button", { name: "Ganti nama pilihan" }).click();
  await expect
    .poll(
      () =>
        JSON.parse(
          [...fixture.rows.values()][0]?.payload.files["studio.desired.json"] ||
            "{}",
        ).nodes?.find((n: any) => n.id === "floor")?.name,
    )
    .toBe("Panggung");
  await page.getByRole("button", { name: "Tinjau perubahan Studio" }).click();
  await expect(
    page.getByRole("button", { name: "Kirim bundle ke Studio" }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /Saya meninjau perubahan/ }).check();
  await page.getByRole("button", { name: "Kirim bundle ke Studio" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /BELUM diterapkan/ }),
  ).toBeVisible();
  expect(sent.changes).toHaveLength(1);
  expect(sent.changes[0].node.name).toBe("Panggung");
  expect(sent.baseSnapshotId).toBe(snapshot.snapshotId);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: ".artifacts/studio-bridge-mobile.png" });
});

test("AI geometry preview before review, Roblox map editing, snapshots and persistence", async ({
  page,
}) => {
  const fixture = await realAccountFixture(page);
  await page.route("**/api/projects/*/ai", async (r) => {
    const b = r.request().postDataJSON();
    const scene = JSON.parse(b.files["scene.roblox.json"]);
    const template = {
      ...scene.objects[0],
      id: "platform-1",
      name: "Platform AI 1",
      position: [-10, 2, -10],
      size: [6, 1, 6],
      color: "#e9b969",
    };
    scene.objects[0].color = "#3e5760";
    scene.objects.push(template);
    for (let i = 2; i <= 6; i++)
      scene.objects.push({
        ...template,
        id: "platform-" + i,
        name: "Platform AI " + i,
        position: [-10 + (i - 1) * 4, 2 + (i - 1) * 1.5, -10 + (i - 1) * 4],
        color: i === 6 ? "#e89475" : "#74b7a3",
      });
    scene.objects.push({
      ...template,
      id: "gate",
      kind: "model",
      name: "Gerbang AI",
      position: [10, 10, 10],
      size: [1, 1, 1],
    });
    for (const [id, pos, size] of [
      ["kiri", [-2, 2, 0], [0.6, 4, 0.6]],
      ["kanan", [2, 2, 0], [0.6, 4, 0.6]],
      ["atas", [0, 4, 0], [4.6, 0.6, 0.6]],
    ] as const)
      scene.objects.push({
        ...template,
        id: "gate-" + id,
        name: "Gerbang " + id,
        parent: "gate",
        position: pos,
        size,
        color: "#dcdaaf",
      });
    await r.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ type: "result", result: { content: "Fixture AI membuat geometri map untuk preview; bukan provider live.", files: { "scene.roblox.json": JSON.stringify(scene, null, 2), "ServerScriptService/Main.server.luau": b.files["ServerScriptService/Main.server.luau"] + "\n-- Script fixture map" } } })}\n\n`,
    });
  });
  await loginRealFixture(page);
  await page
    .getByRole("button", { name: "Buat project pertama", exact: true })
    .click();
  await page.getByRole("radio", { name: /Roblox Game/ }).check();
  await page
    .getByPlaceholder("Buat game Roblox tentang…")
    .fill("Map obby hasil AI");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await expect(page.locator(".rb-scene-status")).toContainText("Usulan AI");
  await expect(
    page.getByLabel("Preview 3D hasil scene Roblox", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".rb-viewport")).toHaveAttribute(
    "data-objects",
    "11",
  );
  expect(
    JSON.parse([...fixture.rows.values()][0].payload.files["scene.roblox.json"])
      .objects,
  ).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Balok", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: ".artifacts/roblox-ai-preview.png" });
  const views = page.getByRole("group", { name: "Tampilan editor" });
  await views.getByRole("button", { name: "Canvas Map", exact: true }).click();
  await expect(
    page.getByLabel("Canvas map Roblox tampak atas", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Geser map kanan", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Terima file", exact: true }).click();
  await expect(page.locator(".review-banner")).toContainText(
    "1 perubahan file",
  );
  await expect(
    page.getByRole("button", { name: "Terima semua", exact: true }),
  ).toBeVisible();
  // Accepting geometry must not silently drop the accompanying Luau proposal.
  await page.getByRole("button", { name: "Terima semua", exact: true }).click();
  await expect(page.locator(".rb-scene-status")).toContainText(
    "Hasil scene tersimpan",
  );
  await views.getByRole("button", { name: "Canvas Map", exact: true }).click();
  await page
    .locator(".rb-explorer")
    .getByRole("button", { name: /^Platform AI 1(?: block)?$/ })
    .click();
  await page.getByRole("combobox", { name: "Snap grid" }).selectOption("2");
  await page
    .getByRole("button", { name: "Geser map kanan", exact: true })
    .click();
  await expect(page.getByLabel("Posisi X", { exact: true })).toHaveValue("-8");
  await page
    .getByLabel("Canvas map Roblox tampak atas", { exact: true })
    .focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByLabel("Posisi Z", { exact: true })).toHaveValue("-12");
  // Drag the real Three.js X-axis gizmo; commit only on pointer release.
  await page
    .getByRole("group", { name: "Manipulasi objek" })
    .getByRole("button", { name: "Geser", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bingkai semua", exact: true })
    .click();
  const rect = await page
    .getByLabel("Canvas map Roblox tampak atas", { exact: true })
    .boundingBox();
  const px = rect!.width / 52;
  const startX = rect!.x + rect!.width / 2 - 8 * px + 24;
  const startY = rect!.y + rect!.height / 2 - 12 * px;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Posisi X", { exact: true }).inputValue()),
    )
    .toBeGreaterThan(-8);
  const movedX = Number(
    await page.getByLabel("Posisi X", { exact: true }).inputValue(),
  );
  await page.screenshot({ path: ".artifacts/roblox-map-desktop.png" });
  await expect
    .poll(
      () =>
        JSON.parse(
          [...fixture.rows.values()][0].payload.files["scene.roblox.json"],
        ).objects.find((o: any) => o.id === "platform-1").position,
    )
    .toEqual([movedX, 2, -12]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByLabel("Canvas map Roblox tampak atas", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  const canvas = page.getByLabel("Canvas map Roblox tampak atas", {
    exact: true,
  });
  await expect
    .poll(() =>
      canvas.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
          el
        );
      }),
    )
    .toBe(true);
  await page.screenshot({ path: ".artifacts/roblox-map-mobile.png" });
  await page.reload();
  await expect(page.locator(".rb-viewport")).toHaveAttribute(
    "data-objects",
    "11",
  );
  await page
    .locator(".rb-explorer")
    .getByRole("button", { name: /^Platform AI 1(?: block)?$/ })
    .click();
  await expect(page.getByLabel("Posisi X", { exact: true })).toHaveValue(
    String(movedX),
  );
  await expect(page.getByLabel("Posisi Z", { exact: true })).toHaveValue("-12");
});

test("invalid AI geometry cannot replace the last saved scene", async ({
  page,
}) => {
  const fixture = await realAccountFixture(page);
  await page.route("**/api/projects/*/ai", (r) =>
    r.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ type: "result", result: { content: "Fixture invalid geometry", files: { "scene.roblox.json": '{"version":1,"objects":[{"kind":"oops"}]}' } } })}\n\n`,
    }),
  );
  await loginRealFixture(page);
  await page
    .getByRole("button", { name: "Buat project pertama", exact: true })
    .click();
  await page.getByRole("radio", { name: /Roblox Game/ }).check();
  await page
    .getByPlaceholder("Buat game Roblox tentang…")
    .fill("Scene ditolak");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await expect(page.locator(".rb-workbench").getByRole("alert")).toContainText(
    "Scene tidak valid",
  );
  await page.getByRole("button", { name: "Terima semua", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Terima semua", exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse([...fixture.rows.values()][0].payload.files["scene.roblox.json"])
      .objects[0].id,
  ).toBe("baseplate");
  await page.getByRole("button", { name: "Tolak", exact: true }).click();
  await expect(
    page.getByLabel("Preview 3D hasil scene Roblox", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".rb-viewport")).toHaveAttribute(
    "data-objects",
    "1",
  );
});
