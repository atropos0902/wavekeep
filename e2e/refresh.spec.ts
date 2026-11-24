import { expect, test } from "@playwright/test";
import { signIn } from "./help.ts";

test("a saved change shows every time, without a reload", async ({ page }) => {
  test.setTimeout(120_000);
  const { base } = await signIn(page, "owner@northlight.example");
  for (let i = 0; i < 20; i++) {
    await page.goto(`${base}/reports`);
    const title = `Refresh ${i} of ${Date.now()}`;
    await page.getByLabel(/New report on wave/).fill(title);
    await page.getByRole("button", { name: "Save draft" }).click();
    const card = page.locator("article", { hasText: title });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Send for review" }).click();
    await expect(card.getByRole("button", { name: "Approve" })).toBeVisible();
  }
});
