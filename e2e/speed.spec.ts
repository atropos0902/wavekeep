import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SCREENS, settled, signIn } from "./help.ts";

// Interaction to next paint as the browser reports it, with the CPU slowed four times.
test("interactions paint quickly on a slow phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(() => {
    const w = window as unknown as { __seen: Map<number, number> };
    w.__seen = new Map();
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEventTiming & { interactionId?: number })[])
        if (e.interactionId) w.__seen.set(e.interactionId, Math.max(w.__seen.get(e.interactionId) ?? 0, e.duration));
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
  const { base } = await signIn(page, "owner@northlight.example");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const out: Record<string, { events: number; slowerThan16ms: number; p75: number; worst: number }> = {};
  const acts: Record<string, () => Promise<void>> = {
    overview: async () => {
      for (const box of ["Gemini API", "OpenAI API"]) {
        await page.getByLabel(box).click();
        await page.waitForTimeout(500);
        await page.getByLabel(box).click();
        await page.waitForTimeout(500);
      }
      for (let i = 0; i < 4; i++) {
        await page.locator("button.numlink").nth(i).click();
        await page.waitForTimeout(500);
        await page.getByRole("button", { name: "Close" }).click();
        await page.waitForTimeout(250);
      }
    },
    compare: async () => {
      for (const box of ["Gemini API", "OpenAI API", "OpenAI API"]) {
        await page.getByLabel(box).click();
        await page.waitForTimeout(600);
      }
    },
    sources: async () => {
      for (const name of ["Site", "Pages", "Page", "Title", "Show more"]) {
        await page.getByRole("button", { name }).first().click();
        await page.waitForTimeout(250);
      }
    },
    questions: async () => {
      await page.getByLabel("New exploration question").click();
      await page.keyboard.type("Does it matter?", { delay: 60 });
    },
    names: async () => {
      await page.getByLabel("Names, one per line").first().click();
      await page.keyboard.type(" x", { delay: 60 });
      await page.getByLabel("What changed").click();
      await page.keyboard.type("nothing", { delay: 60 });
    },
    waves: async () => {
      for (const box of ["Claude API", "Gemini API", "Claude API"]) await page.getByLabel(box).click();
      await page.getByLabel("Repeats").press("ArrowUp");
    },
    reports: async () => {
      await page.getByLabel("Note for the reader").click();
      await page.keyboard.type("A short note", { delay: 60 });
      await page.getByText("Edit", { exact: true }).first().click();
    },
  };
  for (const s of SCREENS) {
    await page.goto(`${base}/${s}`);
    await settled(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => (window as unknown as { __seen: Map<number, number> }).__seen.clear());
    const count = () =>
      page.evaluate(() => {
        const n = (performance as unknown as { eventCounts: Map<string, number> }).eventCounts;
        return (n.get("pointerup") ?? 0) + (n.get("keydown") ?? 0);
      });
    const from = await count();
    await acts[s]!();
    await page.waitForTimeout(600);
    const events = (await count()) - from;
    const slow = await page.evaluate(() => [...(window as unknown as { __seen: Map<number, number> }).__seen.values()]);
    // The browser reports nothing for an interaction under 16 ms, so the rest are filled in at 16.
    const all = [...Array<number>(Math.max(0, events - slow.length)).fill(16), ...slow].sort((a, b) => a - b);
    out[s] = {
      events,
      slowerThan16ms: slow.length,
      p75: all[Math.min(all.length - 1, Math.floor(all.length * 0.75))] ?? 0,
      worst: all.at(-1) ?? 0,
    };
  }
  writeFileSync("results/speed.json", `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out));
  for (const s of SCREENS) {
    expect(out[s]!.events, s).toBeGreaterThan(0);
    expect(out[s]!.p75, s).toBeLessThan(200);
  }
});
