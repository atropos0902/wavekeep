import { ENGINES, type Engine } from "@wavekeep/core";
import { type EngineAdapter, liveAdapters, type RecordingSource, replayAdapter } from "@wavekeep/engines";
import { makeBoss, makePool, work } from "@wavekeep/service";
import { HOSPITALS, syntheticAnswer } from "@wavekeep/service/seed";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = makePool(url, 12);

/** Without live engines, the worker plays back made-up answers so the demo can run a wave for free. */
const source: RecordingSource = (engine, req) => ({
  ok: syntheticAnswer(HOSPITALS, {}, engine, req.question.slice(-12), req.question, req.wave, req.repeat),
});
const delay = Number(process.env.REPLAY_DELAY_MS ?? 0);
const live = liveAdapters(process.env);
const adapters = new Map<Engine, EngineAdapter>(
  live.size ? live : ENGINES.map((e) => [e, replayAdapter(e, source, () => Math.random() * delay)]),
);

const boss = makeBoss(url, {
  supervise: true,
  ...(process.env.SUPERVISE_SECONDS ? { intervalSeconds: Number(process.env.SUPERVISE_SECONDS) } : {}),
});
await boss.start();
await work(boss, pool, adapters, { teams: Number(process.env.TEAMS ?? 4), batch: Number(process.env.BATCH ?? 10) });
console.log(`worker on ${live.size ? [...live.keys()].join(", ") : "replay"}`);

process.on("SIGTERM", async () => {
  await boss.stop({ graceful: true, timeout: 20_000 });
  await pool.end();
  process.exit(0);
});
