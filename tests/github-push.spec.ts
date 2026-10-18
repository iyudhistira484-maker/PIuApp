import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { test, expect } from "@playwright/test";

// GitHub push runs entirely in the browser: the token stays in component
// memory (or the Supabase session) and every request goes straight to
// api.github.com. The fake GitHub here records the Git Data API sequence.

test("push project to an existing GitHub repository without persisting the token", async ({
  page,
}) => {
  await page.route("**/api/public/site", (route) =>
    route.fulfill({
      json: { configured: false, settings: {}, broadcasts: [] },
    }),
  );
  await realAccountFixture(page);
  const calls: { method: string; path: string; body: any }[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({
      method: request.method(),
      path: url.pathname,
      body: request.postDataJSON(),
    });
    const reply = (json: unknown) => route.fulfill({ json });
    if (request.method() === "GET" && url.pathname === "/repos/acme/demo")
      return reply({ default_branch: "main", permissions: { push: true } });
    if (
      request.method() === "GET" &&
      url.pathname === "/repos/acme/demo/git/ref/heads/main"
    )
      return reply({ object: { sha: "base" } });
    if (
      request.method() === "GET" &&
      url.pathname === "/repos/acme/demo/git/commits/base"
    )
      return reply({ tree: { sha: "base-tree" } });
    if (
      request.method() === "POST" &&
      url.pathname === "/repos/acme/demo/git/trees"
    )
      return reply({ sha: "tree-new" });
    if (
      request.method() === "POST" &&
      url.pathname === "/repos/acme/demo/git/commits"
    )
      return reply({ sha: "commit-new" });
    if (
      request.method() === "PATCH" &&
      url.pathname === "/repos/acme/demo/git/refs/heads/main"
    )
      return reply({ object: { sha: "commit-new" } });
    return route.fulfill({ status: 404, json: { message: "not found" } });
  });

  await page.goto("/login");
  await loginRealFixture(page);
  await page
    .getByRole("button", { name: "Buat project pertama", exact: true })
    .click();
  await page
    .getByPlaceholder("Buat website portfolio untuk studio desain saya…")
    .fill("Repo Uji");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await expect(
    page.locator('iframe[title="Live preview aplikasi Anda"]'),
  ).toBeVisible();

  await page.getByRole("button", { name: "Repositori" }).click();
  const dialog = page.getByRole("dialog", { name: "Hubungkan repositori" });
  await expect(dialog.getByText("GitHub belum terhubung")).toBeVisible();
  await dialog
    .getByLabel("Token akses GitHub")
    .fill("ghp_super_secret_test_token");
  await dialog.getByLabel("Repositori", { exact: true }).fill("acme/demo");
  await dialog
    .getByLabel("Pesan commit", { exact: true })
    .fill("Push dari uji");
  await dialog.getByRole("button", { name: "Push ke GitHub" }).click();

  await expect(dialog.getByText("Push berhasil.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Commit/ })).toHaveAttribute(
    "href",
    "https://github.com/acme/demo/commit/commit-new",
  );
  const tree = calls.find((call) => call.path.endsWith("/git/trees"));
  expect(tree?.body.base_tree).toBe("base-tree");
  expect(
    tree?.body.tree.some((entry: any) => entry.path.endsWith("src/App.tsx")),
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.method === "PATCH" &&
        call.path === "/repos/acme/demo/git/refs/heads/main",
    ),
  ).toBe(true);
  // The personal token is not written to localStorage or the project.
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain("ghp_super_secret_test_token");
});
