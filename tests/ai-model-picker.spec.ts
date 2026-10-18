import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  realAccountFixture,
  loginRealFixture,
  modelCatalogue,
} from "./helpers-real";

async function openWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await loginRealFixture(page);
  await page.getByRole("button", { name: "Buat project pertama" }).click();
  await page
    .getByPlaceholder("Buat website portfolio untuk studio desain saya…")
    .fill("Pemilih model AI");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await page.waitForSelector(".chat-composer");
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0, { timeout: 20000 });
  // The workspace refuses a turn while the project is not on the server yet
  // ("Sinkronkan project ke cloud terlebih dahulu."), which is correct but means
  // a test that sends its own message must wait for the first write to land.
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible({ timeout: 20000 });
}

test.beforeEach(async ({ page }) => {
  await realAccountFixture(page);
});

test("AI model picker lists every model the API key serves, grouped, searchable and keyboard driven", async ({
  page,
}) => {
  await openWorkspace(page);
  const trigger = page.getByRole("button", { name: "Pilih model" });
  await expect(trigger).toContainText("Otomatis");
  await trigger.click();
  const list = page.getByRole("listbox", { name: "Daftar model AI" });
  await expect(list).toBeVisible();
  // Every id the key serves appears exactly once, including one whose vendor
  // this app has no special knowledge of.
  for (const model of modelCatalogue)
    await expect(list.locator(`[data-model="${model}"]`)).toHaveCount(1);
  const groups = (await page.locator(".ai-model-group").allTextContents()).join(
    " | ",
  );
  for (const group of [
    "Pintar otomatis",
    "DeepSeek",
    "Anthropic Claude",
    "Z.ai GLM",
    "Model lainnya",
  ])
    expect(groups).toContain(group);
  await expect(
    page.getByText(`${modelCatalogue.length} model dari API key Anda`),
  ).toBeVisible();
  await expect(page.locator(".ai-model-note")).toContainText(
    "harga per pesan dari server",
  );
  // Every model states what one chat turn costs, and the price comes from the
  // server catalogue (costs[]), including the operator's tier override.
  await expect(
    list.locator('[data-model="deepseek-reasoner"] small'),
  ).toHaveText("3 kredit/pesan");
  await expect(
    list.locator('[data-model="claude-sonnet-4-20250514"] small'),
  ).toHaveText("dipakai untuk tier Kuat · 8 kredit");
  await expect(list.locator('[data-model="glm-4.6"] small')).toHaveText(
    "3 kredit/pesan",
  );
  // A tier preset states the range its automatic choice can spend: Otomatis
  // picks Seimbang or Kuat, never the cheapest tier, so the range says 3–8.
  await expect(list.locator('[data-model="Otomatis"] small')).toContainText(
    "3–8 kredit/pesan",
  );
  await expect(list.locator('[data-model="Kuat"] small')).toContainText(
    "8 kredit/pesan",
  );
  // The trigger repeats the price of the current choice, in the menu or not.
  await expect(
    page
      .getByRole("button", { name: "Pilih model" })
      .locator(".ai-model-price"),
  ).toHaveText("3–8 kredit/pesan");
  // Search narrows the list...
  await page.getByLabel("Cari model").fill("deepseek");
  await expect(list.locator("[data-model]")).toHaveCount(2);
  await expect(list.locator('[data-model="deepseek-chat"]')).toBeVisible();
  await page.getByLabel("Cari model").fill("tidak-ada-model-ini");
  await expect(list.getByText("Tidak ada model yang cocok")).toBeVisible();
  // ...and the tier presets come back when the query matches them.
  await page.getByLabel("Cari model").fill("otomatis");
  await expect(list.locator('[data-model="Otomatis"]')).toBeVisible();
  // Keyboard selection: type a vendor, arrow to the first match, Enter.
  await page.getByLabel("Cari model").fill("glm");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText("glm-4-flash");
  await expect(trigger).toContainText("Z.ai GLM");
});

test("AI model picker sends the chosen model and shows which model answered", async ({
  page,
}) => {
  const sent: any[] = [];
  await page.route("**/api/projects/**/ai", async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    return route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        type: "result",
        result: {
          // Names the prompt it answers: the creation turn runs before the
          // choice is made, and an identical reply would satisfy the wait below
          // with the wrong request (the model it carried was still "Otomatis").
          content: `Jawaban dengan model pilihan untuk: ${body.prompt}`,
          creditsUsed: 3,
          model: body.model,
          tier: "Seimbang",
        },
      })}\n\n`,
    });
  });
  await openWorkspace(page);
  await page.getByRole("button", { name: "Pilih model" }).click();
  await page.getByRole("option", { name: /deepseek-reasoner/ }).click();
  await expect(page.getByRole("button", { name: "Pilih model" })).toContainText(
    "deepseek-reasoner",
  );
  // The trigger keeps showing the price of the chosen model.
  await expect(
    page
      .getByRole("button", { name: "Pilih model" })
      .locator(".ai-model-price"),
  ).toHaveText("3 kredit/pesan");
  // Credits follow the server rule: a provider model bills as Seimbang.
  await expect(page.locator(".composer-footer > span")).toContainText(
    "Estimasi 3 kredit",
  );
  await page.getByLabel("Pesan untuk AI").fill("Jelaskan struktur project");
  await page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  // Wait for the answer to *this* prompt before reading what was sent.
  await expect(
    page.getByText(
      "Jawaban dengan model pilihan untuk: Jelaskan struktur project",
      {
        exact: true,
      },
    ),
  ).toBeVisible({ timeout: 15000 });
  expect(sent.at(-1)?.prompt).toBe("Jelaskan struktur project");
  expect(sent.at(-1)?.model).toBe("deepseek-reasoner");
  // The reply names the model that answered, and the choice survives a reload.
  // The last assistant message is the one that just answered; the creation turn
  // above it was answered by the automatic tier.
  await expect(
    page.locator(".chat-message.assistant .message-author").last(),
  ).toContainText("deepseek-reasoner");
  await page.reload();
  await page.waitForSelector(".chat-composer");
  await expect(page.getByRole("button", { name: "Pilih model" })).toContainText(
    "deepseek-reasoner",
  );
  // The expensive model the operator mapped to Kuat is priced where it is
  // chosen: 8 credits, and the composer estimate agrees before sending.
  await page.getByRole("button", { name: "Pilih model" }).click();
  // The id also appears in the tier hints, so pick the option by its own id.
  await page.locator('[data-model="claude-sonnet-4-20250514"]').click();
  await expect(page.locator(".composer-footer > span")).toContainText(
    "Estimasi 8 kredit",
  );
  await expect(
    page
      .getByRole("button", { name: "Pilih model" })
      .locator(".ai-model-price"),
  ).toHaveText("8 kredit/pesan");
});

test("AI model picker stays honest when the provider list cannot be read", async ({
  page,
}) => {
  await page.unroute("**/api/ai/models**");
  await page.route("**/api/ai/models**", (r) =>
    r.fulfill({
      status: 503,
      json: {
        error: "Provider AI tidak dapat dijangkau.",
        models: [],
        retryable: true,
      },
    }),
  );
  await openWorkspace(page);
  await page.getByRole("button", { name: "Pilih model" }).click();
  const list = page.getByRole("listbox", { name: "Daftar model AI" });
  const menu = page.locator(".ai-model-menu");
  await expect(
    menu.getByText("Provider AI tidak dapat dijangkau."),
  ).toBeVisible();
  await expect(menu.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  // Tier presets remain selectable and the picker keeps no fake model list.
  await expect(list.getByRole("option", { name: /Kuat/ })).toHaveCount(1);
  await expect(list.getByRole("option")).toHaveCount(4);
  // Without a catalogue the presets still state their own price rather than
  // implying a free turn or a number nobody will charge.
  await expect(list.locator('[data-model="Kuat"] small')).toContainText(
    "8 kredit/pesan",
  );
  await expect(list.locator('[data-model="Cepat"] small')).toContainText(
    "1 kredit/pesan",
  );
  await list.getByRole("option", { name: /Kuat/ }).click();
  await expect(page.getByRole("button", { name: "Pilih model" })).toContainText(
    "Kuat",
  );
  await expect(page.locator(".composer-footer > span")).toContainText(
    "Estimasi 8 kredit",
  );
});

test("AI model picker popover is accessible and fits a narrow panel", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Pilih model" }).click();
  const list = page.getByRole("listbox", { name: "Daftar model AI" });
  await expect(list).toBeVisible();
  const box = await page.locator(".ai-model-menu").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(1000);
  expect(
    (await new AxeBuilder({ page }).include(".ai-model-menu").analyze())
      .violations,
  ).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(list).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const mobile = await page.locator(".ai-model-menu").boundingBox();
  expect(mobile!.x + mobile!.width).toBeLessThanOrEqual(390);
  expect(
    (await new AxeBuilder({ page }).include(".ai-model-menu").analyze())
      .violations,
  ).toEqual([]);
});
