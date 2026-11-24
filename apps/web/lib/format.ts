import type { Comparison, DroppedEngine, Rate } from "@wavekeep/core";
import { ENGINE_LABEL, type Engine } from "@wavekeep/core";

export const pct = (x: number | null, digits = 1): string => (x === null ? "none" : `${(x * 100).toFixed(digits)}%`);
export const pts = (x: number): string =>
  Math.abs(x * 100) < 0.05 ? "0.0" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;
export const dollars = (micros: number): string => `$${(micros / 1e6).toFixed(2)}`;
export const engineName = (e: string): string => ENGINE_LABEL[e as Engine] ?? e;

export function dropText(d: DroppedEngine): string {
  const name = engineName(d.engine);
  if (d.reason === "model_changed") return `${name} left out: its model changed`;
  if (d.reason === "only_one_wave") return `${name} left out: asked in one wave only`;
  const worst = Math.min(d.before ?? 1, d.after ?? 1);
  return `${name} left out: ${pct(worst, 0)} completed`;
}
export function verdictText(c: Comparison): string {
  if (!c.comparable) return c.why === "no_engine_left" ? "No engine compares" : "No shared question";
  if (c.verdict === "up") return "Up";
  if (c.verdict === "down") return "Down";
  return "Can't tell";
}
export const rateText = (r: Rate): string =>
  r.rate === null ? "No answers" : r.asRange && r.bounds ? `${pct(r.bounds[0])} to ${pct(r.bounds[1])}` : pct(r.rate);
