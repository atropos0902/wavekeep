import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SCREENS, settled, signIn } from "./help.ts";

const OWNER = "owner@northlight.example";

test("the third wave is shown as a range and not as a gain", async ({ page }) => {
  await signIn(page, OWNER);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/named in [\d.]+% to [\d.]+% of answers/);
  await expect(page.getByText("Gemini API left out: 23% completed.")).toBeVisible();
  await page.getByRole("link", { name: "See the comparison" }).click();
  await expect(page.getByText("Subtracting the two pooled rates would say")).toBeVisible();
  await expect(page.locator("main strong").first()).toHaveText("Can't tell");
});

test("every number on the page equals the evidence drawer", async ({ page }) => {
  test.setTimeout(400_000);
  const { base } = await signIn(page, OWNER);
  let checked = 0;
  for (const wave of [1, 2, 3])
    for (const query of ["", "?engines=gemini", "?engines=openai", "?kind=explore"]) {
      await page.goto(`${base.replace(/\/\d+\./, `/${wave}.`)}/overview${query}`);
      await settled(page);
      for (const link of await page.locator("button.numlink").all()) {
        const want = await link.textContent();
        await link.click();
        await expect(page.getByTestId("evidence-total")).toHaveText(want!);
        await expect(page.getByText("These don't agree")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog")).not.toHaveAttribute("open");
        checked++;
      }
    }
  expect(checked).toBe(3 * 4 * 30);
});

for (const scheme of ["light", "dark"] as const)
  test(`no axe violations, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/sign-in");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const { base } = await signIn(page, OWNER);
    for (const s of SCREENS) {
      await page.goto(`${base}/${s}`);
      await settled(page);
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.map((v) => `${s}: ${v.id} ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
    }
    await page.goto(`${base}/overview`);
    await page.locator("button.numlink").first().click();
    await expect(page.getByTestId("evidence-total")).toBeVisible();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `drawer: ${v.id} ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });

test("no sideways scroll on a phone, on any screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { base } = await signIn(page, OWNER);
  for (const s of SCREENS) {
    await page.goto(`${base}/${s}`);
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), s).toBeLessThanOrEqual(375);
  }
});

test("works by keyboard alone, from sign in to an answer and a report", async ({ page }) => {
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.waitForURL(/overview/);
  await settled(page);
  const reach = async (match: (text: string) => boolean): Promise<void> => {
    for (let i = 0; i < 160; i++) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        return (
          e?.getAttribute("aria-label") ??
          (e as HTMLInputElement | null)?.labels?.[0]?.textContent ??
          e?.textContent ??
          ""
        );
      });
      if (match(label.trim())) return;
    }
    throw new Error("never reached by Tab");
  };
  await reach((t) => /^\d+ answers, named, Saint/.test(t));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("evidence-total")).toBeVisible();
  await reach((t) => t === "Answers" || t.startsWith("Show more") || t.endsWith(".example"));
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: /answers, named, Saint/ })).toBeFocused();
  await page.locator("body").press("Home");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await reach((t) => t.toLowerCase() === "reports");
  await page.keyboard.press("Enter");
  await page.waitForURL(/reports/);
  await settled(page);
  await reach((t) => t.startsWith("New report on wave"));
  await page.keyboard.type("Typed with the keyboard");
  await reach((t) => t === "Save draft");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Typed with the keyboard" })).toBeVisible();
});

test("a report goes from draft to a shared page, and a revoked link stops opening", async ({ page, browser }) => {
  const { base } = await signIn(page, OWNER);
  await page.goto(`${base.replace(/\/\d+\./, "/2.")}/reports`);
  await page.getByLabel(/New report on wave 2/).fill("For the board");
  await page.getByRole("button", { name: "Save draft" }).click();
  const card = page.locator("article", { hasText: "For the board" });
  await card.getByRole("button", { name: "Send for review" }).click();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Approved", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Create a share link" }).click();
  const href = await card.getByRole("link").getAttribute("href");
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(`http://127.0.0.1:4310${href}`);
  await expect(stranger.getByRole("heading", { name: "For the board" })).toBeVisible();
  await expect(stranger.getByText("44.9%").first()).toBeVisible();
  await card.getByRole("button", { name: "Revoke link 1" }).click();
  await expect(card.getByText("no longer opens")).toBeVisible();
  await stranger.reload();
  await expect(stranger.getByText("These numbers aren't here")).toBeVisible();
});

test("another workspace gets nothing from any page or route", async ({ page, browser }) => {
  const north = await signIn(page, OWNER);
  await page.goto(`${north.base}/overview`);
  await settled(page);
  const own = await page
    .locator("button.numlink")
    .first()
    .evaluate(() => new URL(location.href).pathname);
  await page.locator("button.numlink").first().click();
  await page.waitForURL(/evidence=/);
  const brand = new URL(page.url()).searchParams.get("evidence")!.split(":")[0]!;
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4310" });
  const other = await context.newPage();
  await signIn(other, "owner@tidewater.example");
  for (const s of SCREENS) {
    await other.goto(own.replace("overview", s));
    await expect(other.getByText("These numbers aren't here")).toBeVisible();
    expect(await other.content()).not.toContain("Saint Mary");
  }
  const api = [
    `/api/evidence?project=${north.project}&pin=3.1.1.3&brand=${brand}&metric=named&outcome=hit`,
    `/api/waves?project=${north.project}`,
    `/go/${north.project}`,
  ];
  for (const url of api) {
    const res = await context.request.get(url);
    expect(await res.text(), url).not.toContain("Saint Mary");
    expect(await res.text(), url).not.toContain("St. Mary");
  }
  const nobody = await browser.newContext({ baseURL: "http://127.0.0.1:4310" });
  for (const url of api.slice(0, 2)) expect((await nobody.request.get(url)).status()).toBe(401);
});

test("a client account reads approved reports and no other screen", async ({ page }) => {
  const { base } = await signIn(page, "client@northlight.example");
  expect(page.url()).toContain("/reports");
  await expect(page.getByRole("heading", { name: "Second wave, for the client" })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toHaveCount(0);
  for (const s of SCREENS.filter((x) => x !== "reports")) {
    await page.goto(`${base}/${s}`);
    await expect(page.getByRole("heading", { name: "This screen is for the agency's staff" })).toBeVisible();
  }
});

test("a wave runs from the page to numbers", async ({ page }) => {
  test.skip(!process.env.WORKER, "needs the worker");
  test.setTimeout(120_000);
  const { project } = await signIn(page, OWNER);
  await page.getByLabel("Project").selectOption({ label: "Lakeside Medical Center" });
  await page.waitForURL((u) => u.pathname.includes("overview") && !u.pathname.includes(project));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lakeside");
  await page.getByRole("link", { name: "waves" }).click();
  await page.getByLabel("Repeats").fill("2");
  await expect(page.getByText("108 captures")).toBeVisible();
  await page.getByRole("button", { name: "Start wave" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page.waitForURL(/\/3\.1\.1\.3\/overview/, { timeout: 90_000 });
  await settled(page);
  await expect(page.getByText("54 of 54 completed").first()).toBeVisible();
});
