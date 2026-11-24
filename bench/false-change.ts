// How often an unchanged brand is reported as changed, with the product's own compareWaves.
import { type Cell, compareWaves, seeded, type WaveData } from "@wavekeep/core";
import { save } from "./save.ts";

const rnd = seeded(51807);
const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
const FAMILIES = 25;
const REPEATS = 4;
const TRIALS = 2000;

function wave(key: string, base: [number, number][], shift: number[], fail: [number, number]): WaveData {
  const cells: Cell[] = [];
  for (let f = 0; f < FAMILIES; f++)
    for (const [e, engine] of (["a", "b"] as const).entries()) {
      let done = 0;
      let hits = 0;
      for (let r = 0; r < REPEATS; r++) {
        if (rnd() < fail[e]!) continue;
        done++;
        if (rnd() < logistic(base[f]![e]! + shift[f]!)) hits++;
      }
      cells.push({ family: `f${f}`, question: `q${f}`, engine, planned: REPEATS, done, hits });
    }
  const engines = ["a", "b"].map((engine) => ({
    engine,
    model: "m",
    planned: FAMILIES * REPEATS,
    done: cells.filter((c) => c.engine === engine).reduce((s, c) => s + c.done, 0),
  }));
  return { key, engines, cells };
}
function pooledSaysChanged(a: WaveData, b: WaveData): boolean {
  const t = (w: WaveData) => w.cells.reduce((s, c) => ({ n: s.n + c.done, k: s.k + c.hits }), { n: 0, k: 0 });
  const x = t(a);
  const y = t(b);
  const p = (x.k + y.k) / (x.n + y.n);
  const se = Math.sqrt(p * (1 - p) * (1 / x.n + 1 / y.n));
  return se > 0 && Math.abs(y.k / y.n - x.k / x.n) / se > 1.959964;
}
function run(o: { drift?: number; lift?: number; fail?: [number, number] }) {
  let pooled = 0;
  let product = 0;
  for (let t = 0; t < TRIALS; t++) {
    const base = Array.from({ length: FAMILIES }, (): [number, number] => {
      const g = gauss() * 1.5;
      return [g, g - 2];
    });
    const a = wave(
      `a${t}`,
      base,
      base.map(() => 0),
      [0, 0],
    );
    const b = wave(
      `b${t}`,
      base,
      base.map(() => gauss() * (o.drift ?? 0) + (o.lift ?? 0)),
      o.fail ?? [0, 0],
    );
    if (pooledSaysChanged(a, b)) pooled++;
    if (compareWaves(a, b).verdict !== "cant_tell") product++;
  }
  return { pooled: pooled / TRIALS, product: product / TRIALS };
}
save("false-change", {
  pairs: TRIALS,
  "nothing changed, all completed": run({}),
  "nothing changed, one engine lost 75%": run({ fail: [0, 0.75] }),
  "questions drift, sd 1.0": run({ drift: 1 }),
  "questions drift, sd 1.5": run({ drift: 1.5 }),
  "real lift +0.6": run({ lift: 0.6 }),
  "real lift +0.6, one engine lost 75%": run({ lift: 0.6, fail: [0, 0.75] }),
});
