import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Cell,
  compareWaves,
  completion,
  type EngineWave,
  familyInterval,
  signFlip,
  usableEngines,
  type WaveData,
  waveRate,
} from "./compare.ts";

const engine = (name: string, planned: number, done: number, model = "m1"): EngineWave => ({
  engine: name,
  model,
  planned,
  done,
});
const cell = (family: string, question: string, e: string, done: number, hits: number, planned = 4): Cell => ({
  family,
  question,
  engine: e,
  planned,
  done,
  hits,
});
/** Twenty families, one question each, on one engine. */
const wave = (key: string, hits: (i: number) => number, n = 20, e = "a"): WaveData => ({
  key,
  engines: [engine(e, n * 4, n * 4)],
  cells: Array.from({ length: n }, (_, i) => cell(`f${String(i).padStart(2, "0")}`, `q${i}`, e, 4, hits(i))),
});

describe("usableEngines", () => {
  it("keeps an engine at exactly the floor and drops one below it, in either wave", () => {
    expect(usableEngines([engine("a", 100, 90)], [engine("a", 100, 100)]).keep).toEqual(["a"]);
    expect(usableEngines([engine("a", 100, 89)], [engine("a", 100, 100)]).dropped).toEqual([
      { engine: "a", reason: "incomplete", before: 0.89, after: 1 },
    ]);
    expect(usableEngines([engine("a", 100, 100)], [engine("a", 100, 89)]).dropped).toEqual([
      { engine: "a", reason: "incomplete", before: 1, after: 0.89 },
    ]);
  });
  it("drops an engine whose model changed", () => {
    expect(usableEngines([engine("a", 4, 4)], [engine("a", 4, 4, "m2")])).toEqual({
      keep: [],
      dropped: [{ engine: "a", reason: "model_changed", before: 1, after: 1 }],
    });
  });
  it("drops an engine asked in one wave only, or planned for nothing", () => {
    expect(usableEngines([engine("a", 4, 4), engine("b", 4, 4)], [engine("a", 4, 4)])).toEqual({
      keep: ["a"],
      dropped: [{ engine: "b", reason: "only_one_wave", before: 1, after: null }],
    });
    expect(usableEngines([engine("a", 4, 4)], [engine("b", 4, 4)]).dropped).toEqual([
      { engine: "a", reason: "only_one_wave", before: 1, after: null },
      { engine: "b", reason: "only_one_wave", before: null, after: 1 },
    ]);
    expect(usableEngines([engine("a", 4, 4)], [engine("a", 0, 0)]).dropped[0]?.reason).toBe("only_one_wave");
  });
  it("lists engines in name order", () => {
    const xs = [engine("c", 4, 4), engine("a", 4, 4), engine("b", 4, 4)];
    expect(usableEngines(xs, xs).keep).toEqual(["a", "b", "c"]);
  });
  it("reports completion as a share, and nothing planned as zero", () => {
    expect(completion(engine("a", 8, 2))).toBe(0.25);
    expect(completion(engine("a", 0, 0))).toBe(0);
  });
});

describe("signFlip", () => {
  it("is exact for few families", () => {
    expect(signFlip([1, 1, 1, 1], 1)).toBe(2 / 16);
    expect(signFlip([1, 1, 1, 1, 1], 1)).toBe(2 / 32);
    expect(signFlip([1, -1], 1)).toBe(1);
    expect(signFlip([1, 2], 1)).toBe(0.5);
    expect(signFlip([], 1)).toBe(1);
    expect(signFlip([0, 0, 0], 1)).toBe(1);
  });
  it("counts ties at the observed value", () => {
    expect(signFlip([0.1, 0.2, 0.3], 1)).toBe(2 / 8);
  });
  it("is exact at 14 and sampled at 15, and the two agree closely", () => {
    const d14 = Array.from({ length: 14 }, (_, i) => (i % 3 === 0 ? -0.4 : 0.5));
    const exact = signFlip(d14, 1);
    expect(signFlip(d14, 999)).toBe(exact);
    const d15 = [...d14, 0.0];
    const sampled = signFlip(d15, 7);
    expect(sampled).not.toBe(exact);
    expect(Math.abs(sampled - exact)).toBeLessThan(0.04);
  });
  it("never reaches zero when sampled", () => {
    expect(signFlip(Array(30).fill(1), 3)).toBe(1 / 2000);
    expect(signFlip(Array(30).fill(0), 3)).toBe(1);
  });
  it("doesn't care about direction", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 10 }), (d) => {
        expect(
          signFlip(
            d.map((x) => -x),
            1,
          ),
        ).toBe(signFlip(d, 1));
      }),
    );
  });
});

describe("familyInterval", () => {
  it("needs two families", () => {
    expect(familyInterval([0.3], 1)).toBeNull();
    expect(familyInterval([], 1)).toBeNull();
    expect(familyInterval([0.3, 0.3], 1)).toEqual([0.3, 0.3]);
  });
  it("covers the mean at about the rate it claims", () => {
    let inside = 0;
    for (let s = 1; s <= 300; s++) {
      const v = Array.from({ length: 30 }, (_, i) => Math.sin(s * 91.7 + i * 47.3) * 0.5);
      const ci = familyInterval(v, s, 399)!;
      if (ci[0] <= 0 && ci[1] >= 0) inside++;
    }
    expect(inside / 300).toBeGreaterThan(0.88);
  });
  it("leaves 2.5 percent on each side", () => {
    const v = Array.from({ length: 200 }, (_, i) => i / 199);
    const [lo, hi] = familyInterval(v, 5)!;
    const se = Math.sqrt(v.reduce((s, x) => s + (x - 0.5) ** 2, 0) / 200 / 200);
    expect(lo).toBeCloseTo(0.5 - 1.96 * se, 2);
    expect(hi).toBeCloseTo(0.5 + 1.96 * se, 2);
  });
});

describe("compareWaves", () => {
  it("is not fooled by an engine dropping out", () => {
    const build = (key: string, bDone: number): WaveData => ({
      key,
      engines: [engine("a", 400, 400), engine("b", 400, bDone * 100)],
      cells: Array.from({ length: 100 }, (_, i) => [
        cell(`f${i % 25}`, `q${i}`, "a", 4, 2),
        cell(`f${i % 25}`, `q${i}`, "b", bDone, bDone === 4 ? (i % 5 === 0 ? 4 : 0) : i % 5 === 0 ? 1 : 0),
      ]).flat(),
    });
    const before = build("w1", 4);
    const after = build("w2", 1);
    expect(waveRate(before).rate).toBeCloseTo(0.35, 10);
    expect(waveRate(after).rate).toBeCloseTo(0.44, 10);
    const c = compareWaves(before, after);
    expect(c).toMatchObject({
      comparable: true,
      why: "ok",
      engines: ["a"],
      delta: 0,
      before: 0.5,
      after: 0.5,
      p: 1,
      verdict: "cant_tell",
    });
    expect(c.dropped).toEqual([{ engine: "b", reason: "incomplete", before: 1, after: 0.25 }]);
  });
  it("finds a clear rise and a clear fall", () => {
    const low = wave("w1", () => 1);
    const high = wave("w2", (i) => (i % 2 ? 3 : 2));
    const up = compareWaves(low, high);
    expect(up).toMatchObject({ verdict: "up", before: 0.25, questionsMatched: 20, questionsLeftOut: 0 });
    expect(up.after).toBeCloseTo(0.625, 10);
    expect(up.delta).toBeCloseTo(0.375, 10);
    expect(up.interval![0]).toBeGreaterThan(0.3);
    expect(up.interval![1]).toBeLessThan(0.45);
    expect(up.p).toBe(1 / 2000);
    const down = compareWaves(high, low);
    expect(down.verdict).toBe("down");
    expect(down.delta).toBeCloseTo(-0.375, 10);
  });
  it("says it can't tell when families disagree", () => {
    const c = compareWaves(
      wave("w1", () => 2),
      wave("w2", (i) => (i % 2 ? 4 : 0)),
    );
    expect(c).toMatchObject({ verdict: "cant_tell", delta: 0 });
    expect(c.interval![0]).toBeLessThan(0);
    expect(c.interval![1]).toBeGreaterThan(0);
  });
  it("never claims a change from too few families to test", () => {
    const c = compareWaves(
      wave("w1", () => 0, 5),
      wave("w2", () => 4, 5),
    );
    expect(c.p).toBe(2 / 32);
    expect(c.verdict).toBe("cant_tell");
    expect(
      compareWaves(
        wave("w1", () => 0, 6),
        wave("w2", () => 4, 6),
      ).verdict,
    ).toBe("up");
  });
  it("leaves out questions that only one wave answered", () => {
    const a = wave("w1", () => 2, 8);
    const b = wave("w2", () => 2, 8);
    b.cells[0] = { ...b.cells[0]!, question: "reworded", hits: 4 };
    b.cells[1] = { ...b.cells[1]!, done: 0, hits: 0 };
    a.cells[2] = { ...a.cells[2]!, done: 0, hits: 0 };
    b.engines = [engine("a", 32, 30)];
    a.engines = [engine("a", 32, 30)];
    const c = compareWaves(a, b);
    expect(c.questionsMatched).toBe(5);
    expect(c.questionsLeftOut).toBe(4);
    expect(c.delta).toBe(0);
    expect(c.pairs.map((p) => p.family)).toEqual(["f03", "f04", "f05", "f06", "f07"]);
  });
  it("weights families equally, however many questions they hold", () => {
    const a: WaveData = {
      key: "a",
      engines: [engine("a", 16, 16)],
      cells: [
        cell("x", "q1", "a", 4, 0),
        cell("x", "q2", "a", 4, 0),
        cell("x", "q3", "a", 4, 0),
        cell("y", "q4", "a", 4, 4),
      ],
    };
    const b: WaveData = { ...a, key: "b", cells: a.cells.map((c) => ({ ...c, hits: c.family === "x" ? 4 : 4 })) };
    const c = compareWaves(a, b);
    expect(c.delta).toBe(0.5);
    expect(c.pairs).toEqual([
      { family: "x", before: 0, after: 1, cells: 3 },
      { family: "y", before: 1, after: 1, cells: 1 },
    ]);
  });
  it("gives the reason when nothing can be compared", () => {
    const a = wave("w1", () => 2);
    expect(
      compareWaves(
        a,
        wave("w2", () => 2, 20, "b"),
      ),
    ).toMatchObject({
      comparable: false,
      why: "no_engine_left",
      engines: [],
      pairs: [],
      before: null,
      after: null,
      delta: null,
      interval: null,
      p: null,
      verdict: "cant_tell",
      questionsMatched: 0,
      questionsLeftOut: 0,
    });
    const b = wave("w2", () => 2);
    b.cells = b.cells.map((c) => ({ ...c, question: `${c.question}-new` }));
    expect(compareWaves(a, b)).toMatchObject({
      comparable: false,
      why: "no_shared_question",
      engines: ["a"],
      questionsLeftOut: 40,
      questionsMatched: 0,
      delta: null,
    });
  });
  it("gives the same numbers on every load, and ignores cell order", () => {
    const a = wave("w1", (i) => i % 4);
    const b = wave("w2", (i) => (i + 1) % 5);
    const once = compareWaves(a, b);
    expect(compareWaves(a, b)).toEqual(once);
    expect(compareWaves({ ...a, cells: [...a.cells].reverse() }, { ...b, cells: [...b.cells].reverse() })).toEqual(
      once,
    );
  });
  it("keeps question and engine ids apart when joined", () => {
    const mk = (key: string, q: string, e: string): WaveData => ({
      key,
      engines: [engine("a", 4, 4), engine('b","a', 4, 4)],
      cells: [cell("f", q, e, 4, 2)],
    });
    expect(compareWaves(mk("1", "q", 'b","a'), mk("2", 'q","b', "a")).why).toBe("no_shared_question");
  });
  it("reverses cleanly", () => {
    const arb = fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 })), {
      minLength: 2,
      maxLength: 12,
    });
    fc.assert(
      fc.property(arb, (rows) => {
        const a = wave("a", (i) => rows[i]![0], rows.length);
        const b = wave("b", (i) => rows[i]![1], rows.length);
        const f = compareWaves(a, b);
        const r = compareWaves(b, a);
        expect(r.delta).toBeCloseTo(-f.delta!, 12);
        expect(r.p).toBe(f.p);
      }),
      { numRuns: 60 },
    );
  });
});

describe("waveRate", () => {
  it("prints one number when enough completed", () => {
    const r = waveRate(wave("w", (i) => (i < 10 ? 4 : 0)));
    expect(r).toMatchObject({
      planned: 80,
      done: 80,
      hits: 40,
      missing: 0,
      rate: 0.5,
      bounds: [0.5, 0.5],
      asRange: false,
    });
    expect(r.interval![0]).toBeGreaterThan(0.2);
    expect(r.interval![0]).toBeLessThan(0.35);
    expect(r.interval![1]).toBeGreaterThan(0.65);
    expect(r.interval![1]).toBeLessThan(0.8);
  });
  it("gives the range from every missing answer a no to every one a yes", () => {
    const r = waveRate({
      key: "w",
      engines: [engine("a", 400, 400), engine("b", 400, 100)],
      cells: [cell("f1", "q1", "a", 400, 200, 400), cell("f2", "q2", "b", 100, 20, 400)],
    });
    expect(r).toMatchObject({ planned: 800, done: 500, hits: 220, missing: 300, rate: 0.44, asRange: true });
    expect(r.bounds).toEqual([0.275, 0.65]);
  });
  it("has no rate without answers", () => {
    expect(waveRate({ key: "w", engines: [], cells: [] })).toEqual({
      planned: 0,
      done: 0,
      hits: 0,
      missing: 0,
      rate: null,
      interval: null,
      bounds: null,
      asRange: false,
    });
    expect(waveRate({ key: "w", engines: [engine("a", 0, 0)], cells: [] }).asRange).toBe(false);
    const none = waveRate({ key: "w", engines: [engine("a", 4, 0)], cells: [cell("f", "q", "a", 0, 0)] });
    expect(none).toMatchObject({ rate: null, interval: null, bounds: [0, 1], asRange: true });
  });
  it("resamples families, so more repeats of one question don't shrink the interval", () => {
    const width = (repeats: number): number => {
      const r = waveRate({
        key: "w",
        engines: [engine("a", 10 * repeats, 10 * repeats)],
        cells: Array.from({ length: 10 }, (_, i) => cell(`f${i}`, `q${i}`, "a", repeats, i % 2 ? repeats : 0, repeats)),
      });
      return r.interval![1] - r.interval![0];
    };
    expect(width(400)).toBeCloseTo(width(4), 10);
  });
  it("skips families with no answers when resampling", () => {
    const r = waveRate({
      key: "w",
      engines: [engine("a", 12, 8)],
      cells: [cell("f1", "q1", "a", 4, 2), cell("f2", "q2", "a", 4, 2), cell("f3", "q3", "a", 0, 0)],
    });
    expect(r.interval).toEqual([0.5, 0.5]);
  });
});
