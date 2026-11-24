import type { Engine } from "@wavekeep/core";
import { type CapturedAnswer, type CaptureRequest, type EngineAdapter, Final, Retryable } from "./adapter.ts";

export type Recording = { ok: CapturedAnswer } | { fail: "retryable" | "final"; message: string };
export type RecordingSource = (engine: Engine, req: CaptureRequest) => Recording | undefined;

/** Plays recorded answers back, so a run costs nothing and gives the same result twice. */
export function replayAdapter(engine: Engine, source: RecordingSource, delayMs: () => number = () => 0): EngineAdapter {
  return {
    engine,
    estimateMicros: 1000,
    async ask(req) {
      const wait = delayMs();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const rec = source(engine, req);
      if (!rec) throw new Final(`no recording for ${engine} ${req.questionKey} wave ${req.wave} repeat ${req.repeat}`);
      if ("ok" in rec) return rec.ok;
      throw rec.fail === "retryable" ? new Retryable(rec.message) : new Final(rec.message);
    },
  };
}
