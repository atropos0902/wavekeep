import { hashSeed, seeded } from "./random.ts";

export const COMPLETION_FLOOR = 0.9;
export const ALPHA = 0.05;

export interface Cell {
  family: string;
  question: string;
  engine: string;
  planned: number;
  done: number;
  hits: number;
}

export interface EngineWave {
  engine: string;
  model: string;
  planned: number;
  done: number;
}

export interface WaveData {
  key: string;
  engines: EngineWave[];
  cells: Cell[];
}

export type DropReason = "only_one_wave" | "model_changed" | "incomplete";

export interface DroppedEngine {
  engine: string;
  reason: DropReason;
  before: number | null;
  after: number | null;
}

export interface FamilyPair {
  family: string;
  before: number;
  after: number;
  cells: number;
}

export type Verdict = "up" | "down" | "cant_tell";

export interface Comparison {
  comparable: boolean;
  why: "ok" | "no_engine_left" | "no_shared_question";
  engines: string[];
  dropped: DroppedEngine[];
  pairs: FamilyPair[];
  questionsMatched: number;
  questionsLeftOut: number;
  before: number | null;
  after: number | null;
  delta: number | null;
  interval: [number, number] | null;
  p: number | null;
  verdict: Verdict;
}

export interface Rate {
  planned: number;
  done: number;
  hits: number;
  missing: number;
  rate: number | null;
  interval: [number, number] | null;
  /** Every missing answer a no, then every missing answer a yes. */
  bounds: [number, number] | null;
  /** True when too much is missing to print one number. */
  asRange: boolean;
}

export const completion = (e: EngineWave): number => (e.planned === 0 ? 0 : e.done / e.planned);
const enough = (e: EngineWave): boolean => e.planned > 0 && e.done / e.planned >= COMPLETION_FLOOR;
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const a = sorted[lo]!;
  const b = sorted[Math.min(lo + 1, sorted.length - 1)]!;
  return a + (b - a) * (at - lo);
}

/** Which engines both waves have on the same footing. */
export function usableEngines(a: EngineWave[], b: EngineWave[]): { keep: string[]; dropped: DroppedEngine[] } {
  const keep: string[] = [];
  const dropped: DroppedEngine[] = [];
  const names = [...new Set([...a, ...b].map((e) => e.engine))].sort();
  for (const engine of names) {
    const x = a.find((e) => e.engine === engine && e.planned > 0);
    const y = b.find((e) => e.engine === engine && e.planned > 0);
    const before = x ? completion(x) : null;
    const after = y ? completion(y) : null;
    if (!x || !y) dropped.push({ engine, reason: "only_one_wave", before, after });
    else if (!enough(x) || !enough(y)) dropped.push({ engine, reason: "incomplete", before, after });
    else if (x.model !== y.model) dropped.push({ engine, reason: "model_changed", before, after });
    else keep.push(engine);
  }
  return { keep, dropped };
}

/**
 * Two-sided sign-flip test on family differences. Exact up to 14 families, sampled above that.
 * Families are the unit because repeats of one question move together.
 */
export function signFlip(diffs: number[], seed: number, flips = 1999): number {
  if (diffs.length === 0) return 1;
  const observed = Math.abs(diffs.reduce((s, d) => s + d, 0));
  const eps = 1e-12;
  if (diffs.length <= 14) {
    const all = 2 ** diffs.length;
    let hit = 0;
    for (let mask = 0; mask < all; mask++) {
      let sum = 0;
      for (let i = 0; i < diffs.length; i++) sum += (mask >> i) & 1 ? diffs[i]! : -diffs[i]!;
      if (Math.abs(sum) >= observed - eps) hit++;
    }
    return hit / all;
  }
  const rnd = seeded(seed);
  let hit = 1;
  for (let f = 0; f < flips; f++) {
    let sum = 0;
    for (const d of diffs) sum += rnd() < 0.5 ? d : -d;
    if (Math.abs(sum) >= observed - eps) hit++;
  }
  return hit / (flips + 1);
}

/** Percentile interval for the mean, resampling whole families. */
export function familyInterval(values: number[], seed: number, draws = 1999): [number, number] | null {
  if (values.length < 2) return null;
  const rnd = seeded(seed);
  const means: number[] = [];
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(rnd() * values.length)]!;
    means.push(sum / values.length);
  }
  means.sort((x, y) => x - y);
  return [quantile(means, ALPHA / 2), quantile(means, 1 - ALPHA / 2)];
}

/** Compare only what both waves have: the same question on the same engine. */
export function compareWaves(a: WaveData, b: WaveData): Comparison {
  const { keep, dropped } = usableEngines(a.engines, b.engines);
  const empty: Comparison = {
    comparable: false,
    why: "no_engine_left",
    engines: keep,
    dropped,
    pairs: [],
    questionsMatched: 0,
    questionsLeftOut: 0,
    before: null,
    after: null,
    delta: null,
    interval: null,
    p: null,
    verdict: "cant_tell",
  };
  if (keep.length === 0) return empty;

  const id = (c: Cell): string => JSON.stringify([c.question, c.engine]);
  const left = new Map(a.cells.filter((c) => keep.includes(c.engine) && c.done > 0).map((c) => [id(c), c]));
  const byFamily = new Map<string, { before: number[]; after: number[] }>();
  const matched = new Set<string>();
  for (const y of b.cells) {
    const x = keep.includes(y.engine) && y.done > 0 ? left.get(id(y)) : undefined;
    if (!x) continue;
    const f = byFamily.get(y.family) ?? { before: [], after: [] };
    f.before.push(x.hits / x.done);
    f.after.push(y.hits / y.done);
    byFamily.set(y.family, f);
    matched.add(y.question);
  }
  const asked = new Set([...a.cells, ...b.cells].map((c) => c.question));
  const questionsLeftOut = asked.size - matched.size;
  if (byFamily.size === 0) return { ...empty, why: "no_shared_question", questionsLeftOut };

  const pairs: FamilyPair[] = [...byFamily]
    .map(([family, f]) => ({ family, before: mean(f.before), after: mean(f.after), cells: f.before.length }))
    .sort((x, y) => (x.family < y.family ? -1 : 1));
  const diffs = pairs.map((f) => f.after - f.before);
  const seed = hashSeed(`${a.key}|${b.key}`);
  const delta = mean(diffs);
  const p = signFlip(diffs, seed);
  const interval = familyInterval(diffs, seed ^ 0x5bd1e995);
  const clear = p < ALPHA && interval !== null && (interval[0] > 0 || interval[1] < 0);
  return {
    comparable: true,
    why: "ok",
    engines: keep,
    dropped,
    pairs,
    questionsMatched: matched.size,
    questionsLeftOut,
    before: mean(pairs.map((f) => f.before)),
    after: mean(pairs.map((f) => f.after)),
    delta,
    interval,
    p,
    verdict: clear ? (delta > 0 ? "up" : "down") : "cant_tell",
  };
}

/** One wave on its own. */
export function waveRate(w: WaveData): Rate {
  const sum = (f: (c: Cell) => number): number => w.cells.reduce((s, c) => s + f(c), 0);
  const planned = sum((c) => c.planned);
  const done = sum((c) => c.done);
  const hits = sum((c) => c.hits);
  const missing = planned - done;
  const families = new Map<string, { done: number; hits: number }>();
  for (const c of w.cells) {
    const f = families.get(c.family) ?? { done: 0, hits: 0 };
    f.done += c.done;
    f.hits += c.hits;
    families.set(c.family, f);
  }
  const list = [...families.values()].filter((f) => f.done > 0);
  let interval: [number, number] | null = null;
  if (list.length >= 2) {
    const rnd = seeded(hashSeed(w.key));
    const rates: number[] = [];
    for (let d = 0; d < 1999; d++) {
      let n = 0;
      let k = 0;
      for (let i = 0; i < list.length; i++) {
        const f = list[Math.floor(rnd() * list.length)]!;
        n += f.done;
        k += f.hits;
      }
      rates.push(k / n);
    }
    rates.sort((x, y) => x - y);
    interval = [quantile(rates, ALPHA / 2), quantile(rates, 1 - ALPHA / 2)];
  }
  return {
    planned,
    done,
    hits,
    missing,
    rate: done === 0 ? null : hits / done,
    interval,
    bounds: planned === 0 ? null : [hits / planned, (hits + missing) / planned],
    asRange: w.engines.some((e) => e.planned > 0 && !enough(e)),
  };
}
