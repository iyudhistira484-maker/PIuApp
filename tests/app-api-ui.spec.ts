import { test, expect } from "@playwright/test";
import { realAccountFixture, loginRealFixture } from "./helpers-real";

// The key panel is the only place a plaintext app-data key ever exists. These
// routes are browser fixtures, not a live Supabase project: the point is that
// the UI asks for the key once, shows it once, and then never prints it again.
test("database panel creates a read key once and revokes it", async ({
  page,
}) => {
  await realAccountFixture(page);
  await loginRealFixture(page);

  const keys: any[] = [];
  const posts: any[] = [];
  await page.route("**/api/projects/*/app-keys", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { keys } });
    const body = request.postDataJSON();
    posts.push(body);
    const key = {
      id: crypto.randomUUID(),
      label: body.label,
      scope: body.scope,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked: false,
    };
    keys.unshift(key);
    return route.fulfill({
      status: 201,
      json: {
        key,
        secret: "piwu_sk_" + "A".repeat(32),
        notice:
          "Simpan kunci ini sekarang. Setelah ditutup, kunci tidak bisa ditampilkan lagi.",
      },
    });
  });
  await page.route("**/api/projects/*/app-keys/*", async (route) => {
    if (route.request().method() !== "DELETE")
      return route.fulfill({ status: 405, json: {} });
    keys.forEach((key) => (key.revoked = true));
    return route.fulfill({ json: { revoked: true } });
  });

  await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { default: Panel } =
      await import("/src/workspace/CloudDataPanel.tsx");
    const repo = {
      async list() {
        return [];
      },
      async get() {
        throw new Error("tidak dipakai");
      },
      async save(table: any) {
        return table;
      },
      async remove() {},
    };
    document.getElementById("root")!.style.display = "none";
    const host = document.createElement("main");
    host.id = "api-fixture";
    host.style.cssText = "background:#11151b;min-height:100vh;padding:24px";
    document.body.append(host);
    createRoot(host).render(
      React.createElement(Panel, {
        account: "d29f9dc0-cb78-4a4a-8d4c-30d287c7b1fa",
        projectId: crypto.randomUUID(),
        role: "Editor",
        repository: repo,
      }),
    );
  });

  const panel = page.locator("#api-fixture");
  await expect(
    panel.getByRole("heading", { name: "API data untuk aplikasi Anda" }),
  ).toBeVisible();
  await expect(
    panel.getByText("Belum ada kunci", { exact: false }),
  ).toBeVisible();

  await panel.getByLabel("Nama kunci").fill("Web publik");
  await panel.getByLabel("Akses").selectOption("read");
  await panel.getByRole("button", { name: "Buat kunci" }).click();

  const secret = panel.locator(".app-api-secret code");
  await expect(secret).toHaveText(/^piwu_sk_A{32}$/);
  await expect(
    panel.getByText("Kunci ini tidak bisa ditampilkan lagi", { exact: false }),
  ).toBeVisible();
  await expect(panel.getByText("Web publik", { exact: true })).toBeVisible();
  await expect(panel.getByText("Baca saja", { exact: true })).toBeVisible();
  expect(posts).toEqual([{ label: "Web publik", scope: "read" }]);

  // Hiding the banner is permanent for that key: the list must not echo it.
  await panel.getByRole("button", { name: "Sembunyikan" }).click();
  await expect(panel.locator(".app-api-secret")).toHaveCount(0);
  await expect(panel.getByText("piwu_sk_", { exact: false })).toHaveCount(0);

  await panel.getByRole("button", { name: "Cabut" }).click();
  await panel.getByRole("button", { name: "Yakin cabut?" }).click();
  await expect(panel.getByText("Dicabut", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("Kunci dicabut", { exact: false }),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "Cabut" })).toHaveCount(0);
});
