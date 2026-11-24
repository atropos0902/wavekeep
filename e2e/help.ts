import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page, email: string): Promise<{ project: string; base: string }> {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/p\//);
  const m = /\/p\/([0-9a-f-]+)\/([\d.]+)/.exec(page.url())!;
  return { project: m[1]!, base: `/p/${m[1]}/${m[2]}` };
}
export const SCREENS = ["overview", "compare", "sources", "questions", "names", "waves", "reports"];
export async function settled(page: Page): Promise<void> {
  await expect(page.locator("main h1").first()).toBeVisible();
}
