import { test, expect } from "@playwright/test";
import { realAccountFixture, loginRealFixture } from "./helpers-real";
test("password recovery uses real auth endpoints, no password update on mismatch or provider failure", async ({
  page,
}) => {
  const fixture = await realAccountFixture(page, false);
  let recovery = 0,
    updates = 0,
    failed = true;
  await page.route("**/auth/v1/recover*", async (r) => {
    recovery++;
    expect(r.request().postDataJSON().email).toBe("test@example.test");
    expect(new URL(r.request().url()).searchParams.get("redirect_to")).toMatch(
      /\/reset-password$/,
    );
    await r.fulfill({ json: {} });
  });
  await page.goto("/login");
  await page.getByRole("link", { name: "Lupa kata sandi?" }).click();
  await expect(
    page.getByRole("heading", { name: "Pulihkan akses akun." }),
  ).toBeVisible();
  await page
    .getByLabel("Alamat email", { exact: true })
    .fill("test@example.test");
  await page.getByRole("button", { name: "Kirim tautan pemulihan" }).click();
  await expect(page.getByRole("status")).toContainText("Permintaan diterima");
  expect(recovery).toBe(1);
  await loginRealFixture(page);
  await expect(page).toHaveURL(/\/projects$/);
  await page.route("**/auth/v1/user", async (r) => {
    if (r.request().method() === "PUT") {
      updates++;
      expect(r.request().postDataJSON().password).toBe("new-test-password-123");
      await r.fulfill(
        failed
          ? {
              status: 422,
              json: { msg: "Password update rejected by fixture" },
            }
          : { json: fixture.user },
      );
    } else await r.fulfill({ json: fixture.user });
  });
  await page.goto("/reset-password");
  await page
    .getByLabel("Kata sandi baru", { exact: true })
    .fill("new-test-password-123");
  await page
    .getByLabel("Konfirmasi kata sandi", { exact: true })
    .fill("wrong-test-password");
  await page.getByRole("button", { name: "Simpan kata sandi baru" }).click();
  await expect(page.getByRole("alert")).toContainText("tidak cocok");
  expect(updates).toBe(0);
  await page
    .getByLabel("Konfirmasi kata sandi", { exact: true })
    .fill("new-test-password-123");
  await page.getByRole("button", { name: "Simpan kata sandi baru" }).click();
  await expect(page.getByRole("alert")).toContainText("rejected");
  await expect(page.getByRole("status")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Simpan kata sandi baru" }).click();
  await expect(page.getByRole("status")).toContainText("berhasil diperbarui");
  expect(updates).toBe(2);
});
test("expired recovery cannot change passwords; malformed URL fragments do not crash app", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await realAccountFixture(page, false);
  await page.goto(
    "/reset-password#error=access_denied&error_description=expired",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Sesi pemulihan tidak tersedia",
  );
  await expect(
    page.getByRole("button", { name: "Simpan kata sandi baru" }),
  ).toBeDisabled();
  await page.goto("/#%E0%A4%A");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});
test("Roblox recording renders scene not React, unsupported web runtime actions are disabled", async ({
  page,
}) => {
  await realAccountFixture(page, false);
  await page.route("**/api/status", (r) =>
    r.fulfill({
      json: {
        mode: "real",
        ai: "not_configured",
        capabilities: {
          cloud: true,
          sandbox: true,
          audit: true,
        },
      },
    }),
  );
  await loginRealFixture(page);
  await page
    .getByRole("button", { name: "Buat project pertama", exact: true })
    .click();
  await page.getByRole("radio", { name: /Roblox Game/ }).check();
  await page.getByPlaceholder("Buat game Roblox tentang…").fill("Audit map");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await expect(
    page.getByLabel("Preview 3D hasil scene Roblox", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rekam", exact: true }).click();
  await page.getByRole("button", { name: "Balok", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Preview 3D hasil scene Roblox", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.locator('iframe[title="Pemutar snapshot rekaman"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Tutup", exact: true }).click();
  await page.getByRole("button", { name: "Paket", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Jalankan preview sandbox" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("status").filter({ hasText: /khusus Web App/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tutup", exact: true }).click();
  await page.getByRole("button", { name: "Layanan", exact: true }).click();
  // The builder publishes nothing: the service panel has no Publish tab.
  await expect(
    dialog.getByRole("button", { name: "Publish", exact: true }),
  ).toHaveCount(0);
});
