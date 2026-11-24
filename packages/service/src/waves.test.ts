import type { Engine } from "@wavekeep/core";
import { type EngineAdapter, Final, Retryable } from "@wavekeep/engines/adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "./context.ts";
import { withWorkspace } from "./db.ts";
import { brandInputs, HOSPITALS, makeWorkspace, questionInputs } from "./seed.ts";
import { createProject } from "./setup.ts";
import { testDatabase } from "./testing.ts";
import { closeWave, listWaves, planWave, runCapture, saveAnswer, startWave } from "./waves.ts";

let db: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  db = await testDatabase(12);
});
afterAll(() => db?.drop());

/** A small project of its own, so tests don't disturb each other. */
async function small(families = 6, repeats = 2) {
  const id = await makeWorkspace(db.owner, "Small", []);
  const ctx: Ctx = { pool: db.pool, workspace: id, role: "owner", account: null };
  const project = await createProject(ctx, {
    name: "P",
    brands: brandInputs(HOSPITALS.slice(0, 2)),
    questions: questionInputs(["a", "b", "c", "d", "e", "f", "g", "h"].slice(0, families), ["nurses"], 0),
  });
  return { ctx, project, repeats };
}
const says = (text: string, model = "m"): EngineAdapter => ({
  engine: "openai",
  estimateMicros: 10,
  ask: async () => ({ text, model, costMicros: 7, sources: [] }),
});
const only = (a: EngineAdapter) => new Map<Engine, EngineAdapter>([[a.engine, a]]);
const captures = async (ctx: Ctx, wave: string) =>
  (
    await withWorkspace(ctx.pool, ctx.workspace, (tx) =>
      tx.query<{ id: number; status: string; error: string | null }>(
        "select id, status, error from capture where wave_id = $1 order by id",
        [wave],
      ),
    )
  ).rows;

describe("capturing", () => {
  it("saves one answer per planned capture, however often the job runs", async () => {
    const { ctx, project } = await small(3);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 2, capMicros: 1_000 });
    const all = await captures(ctx, w.wave);
    expect(all).toHaveLength(6);
    const out = await Promise.all(
      [1, 2, 3, 4].map(() => runCapture(ctx.pool, ctx.workspace, all[0]!.id, only(says("Summit")))),
    );
    expect(out.filter((o) => o === "saved")).toHaveLength(1);
    expect(out.filter((o) => o === "already_done")).toHaveLength(3);
  });
  it("saves the answer, its cost and its sources as they came", async () => {
    const { ctx, project } = await small(1);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 1_000 });
    const [c] = await captures(ctx, w.wave);
    const adapter: EngineAdapter = {
      engine: "openai",
      estimateMicros: 10,
      ask: async () => ({
        text: "a\u0000b",
        model: "m",
        costMicros: 7,
        sources: [
          { url: "https://a.example/x", original: "https://www.a.example/x?utm_source=openai", title: "A" },
          { url: "https://b.example", original: "https://b.example/", title: "B" },
        ],
      }),
    };
    await runCapture(ctx.pool, ctx.workspace, c!.id, only(adapter));
    const r = await withWorkspace(ctx.pool, ctx.workspace, async (tx) => ({
      answer: (
        await tx.query("select text, model, cost_micros, engine, source_kind from answer where wave_id = $1", [w.wave])
      ).rows,
      cites: (
        await tx.query("select ord, url, host, original, title from citation where wave_id = $1 order by ord", [w.wave])
      ).rows,
    }));
    expect(r.answer).toEqual([{ text: "ab", model: "m", cost_micros: 7, engine: "openai", source_kind: "api" }]);
    expect(r.cites).toEqual([
      {
        ord: 0,
        url: "https://a.example/x",
        host: "a.example",
        original: "https://www.a.example/x?utm_source=openai",
        title: "A",
      },
      { ord: 1, url: "https://b.example", host: "b.example", original: "https://b.example/", title: "B" },
    ]);
  });
  it("tries again after a retryable failure, stops at three, and stops at once on a final one", async () => {
    const { ctx, project } = await small(2);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 1_000 });
    const [a, b] = await captures(ctx, w.wave);
    let calls = 0;
    const flaky: EngineAdapter = {
      engine: "openai",
      estimateMicros: 10,
      ask: async () => {
        calls++;
        throw new Retryable("429");
      },
    };
    await expect(runCapture(ctx.pool, ctx.workspace, a!.id, only(flaky))).rejects.toThrow("429");
    await expect(runCapture(ctx.pool, ctx.workspace, a!.id, only(flaky))).rejects.toThrow("429");
    expect(await runCapture(ctx.pool, ctx.workspace, a!.id, only(flaky))).toBe("failed");
    expect(calls).toBe(3);
    const refuse: EngineAdapter = {
      engine: "openai",
      estimateMicros: 10,
      ask: async () => {
        calls++;
        throw new Final("401");
      },
    };
    expect(await runCapture(ctx.pool, ctx.workspace, b!.id, only(refuse))).toBe("failed");
    expect(calls).toBe(4);
    const [wave] = await listWaves(ctx, project);
    expect(wave).toMatchObject({ spent_micros: 0, failed: 2, done: 0 });
  });
  it("never asks again about a finished answer that doesn't name the brand", async () => {
    const { ctx, project } = await small(1);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 1_000 });
    const [a] = await captures(ctx, w.wave);
    expect(await runCapture(ctx.pool, ctx.workspace, a!.id, only(says("nobody")))).toBe("saved");
    expect(await runCapture(ctx.pool, ctx.workspace, a!.id, only(says("Summit")))).toBe("already_done");
  });
  it("stops at the spending cap and says so", async () => {
    const { ctx, project } = await small(6);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 25 });
    for (const c of await captures(ctx, w.wave)) await runCapture(ctx.pool, ctx.workspace, c.id, only(says("x")));
    const all = await captures(ctx, w.wave);
    const [wave] = await listWaves(ctx, project);
    expect(all.filter((c) => c.status === "done")).toHaveLength(3);
    expect(all.filter((c) => c.error === "spending cap reached")).toHaveLength(3);
    expect(wave!.spent_micros).toBe(21);
  });
  it("shows the cost before a wave starts, and refuses a second one", async () => {
    const { ctx, project } = await small(4);
    expect(await planWave(ctx, project, { engines: ["openai"], repeats: 3 }, only(says("x")))).toEqual({
      questions: 4,
      captures: 12,
      estimateMicros: 120,
    });
    await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 10 });
    await expect(startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 10 })).rejects.toThrow(
      "already running",
    );
  });
  it.each([
    [{ engines: [] as Engine[], repeats: 1, capMicros: 1 }, "each engine once"],
    [{ engines: ["openai", "openai"] as Engine[], repeats: 1, capMicros: 1 }, "each engine once"],
    [{ engines: ["openai"] as Engine[], repeats: 0, capMicros: 1 }, "between 1 and 20"],
    [{ engines: ["openai"] as Engine[], repeats: 21, capMicros: 1 }, "between 1 and 20"],
    [{ engines: ["openai"] as Engine[], repeats: 1.5, capMicros: 1 }, "between 1 and 20"],
    [{ engines: ["openai"] as Engine[], repeats: 1, capMicros: 0 }, "spending cap"],
  ])("refuses a bad plan %#", async (plan, message) => {
    const { ctx, project } = await small(1);
    await expect(startWave(ctx, null, project, plan)).rejects.toThrow(message);
  });
});

describe("closing", () => {
  it("waits for pending captures unless closed early, and then stores what came in", async () => {
    const { ctx, project } = await small(3);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 1_000 });
    const all = await captures(ctx, w.wave);
    await runCapture(ctx.pool, ctx.workspace, all[0]!.id, only(says("Summit", "m1")));
    expect(await closeWave(ctx.pool, ctx.workspace, w.wave)).toBeNull();
    expect(await closeWave(ctx.pool, ctx.workspace, w.wave, { early: true })).toEqual({
      planned: 3,
      done: 1,
      failed: 2,
    });
    expect(await closeWave(ctx.pool, ctx.workspace, w.wave, { early: true })).toBeNull();
    expect(await runCapture(ctx.pool, ctx.workspace, all[1]!.id, only(says("late")))).toBe("already_done");
    const [wave] = await listWaves(ctx, project);
    expect(wave).toMatchObject({
      status: "closed",
      planned: 3,
      done: 1,
      failed: 2,
      engines: [{ engine: "openai", planned: 3, done: 1, model: "m1" }],
    });
    expect((await captures(ctx, w.wave)).map((c) => c.status)).toEqual(["done", "failed", "failed"]);
    expect((await captures(ctx, w.wave))[1]!.error).toBe("wave closed before it finished");
    const cells = await withWorkspace(ctx.pool, ctx.workspace, (tx) =>
      tx.query("select engine, planned, done from wave_cell where wave_id = $1 order by done desc", [w.wave]),
    );
    expect(cells.rows).toEqual([
      { engine: "openai", planned: 1, done: 1 },
      { engine: "openai", planned: 1, done: 0 },
      { engine: "openai", planned: 1, done: 0 },
    ]);
  });
  it("refuses an answer that arrives after the close", async () => {
    const { ctx, project } = await small(1);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 1_000 });
    const [c] = await captures(ctx, w.wave);
    await closeWave(ctx.pool, ctx.workspace, w.wave, { early: true });
    const r = await withWorkspace(ctx.pool, ctx.workspace, (tx) =>
      saveAnswer(tx, {
        workspace: ctx.workspace,
        capture: c!.id,
        wave: w.wave,
        text: "x",
        model: "m",
        costMicros: 1,
        sources: [],
      }),
    );
    expect(r).toBe("too_late");
    await expect(
      withWorkspace(ctx.pool, ctx.workspace, (tx) =>
        tx.query(
          "insert into answer (capture_id, workspace_id, wave_id, question_id, engine, text, model, cost_micros) values ($1, $2, $3, gen_random_uuid(), 'openai', 'x', 'm', 1)",
          [c!.id, ctx.workspace, w.wave],
        ),
      ),
    ).rejects.toThrow("wave is closed");
  });
  it("a close waits for an answer being saved, and counts it", async () => {
    const { ctx, project } = await small(1);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 1_000 });
    const [c] = await captures(ctx, w.wave);
    let closing: Promise<unknown> | undefined;
    await withWorkspace(ctx.pool, ctx.workspace, async (tx) => {
      await saveAnswer(tx, {
        workspace: ctx.workspace,
        capture: c!.id,
        wave: w.wave,
        text: "x",
        model: "m",
        costMicros: 1,
        sources: [],
      });
      closing = closeWave(ctx.pool, ctx.workspace, w.wave, { early: true });
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(await closing).toEqual({ planned: 1, done: 1, failed: 0 });
  });
  it("marks an engine that answered with two models as mixed", async () => {
    const { ctx, project } = await small(2);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 1_000 });
    const [a, b] = await captures(ctx, w.wave);
    await runCapture(ctx.pool, ctx.workspace, a!.id, only(says("x", "m1")));
    await runCapture(ctx.pool, ctx.workspace, b!.id, only(says("x", "m2")));
    await closeWave(ctx.pool, ctx.workspace, w.wave);
    expect((await listWaves(ctx, project))[0]!.engines[0]!.model).toBe("mixed: m1, m2");
  });
  it("runs the follow-up in the closing transaction", async () => {
    const { ctx, project } = await small(1);
    const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 1_000 });
    await expect(
      closeWave(ctx.pool, ctx.workspace, w.wave, {
        early: true,
        after: async () => {
          throw new Error("no queue");
        },
      }),
    ).rejects.toThrow("no queue");
    expect((await listWaves(ctx, project))[0]!.status).toBe("open");
    await expect(closeWave(ctx.pool, ctx.workspace, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      "No such wave",
    );
  });
});
