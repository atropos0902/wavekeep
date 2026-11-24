// kill -9 on a worker at random moments, while another one carries on.
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import type { Ctx } from "@wavekeep/service";
import { createProject, listWaves, makeBoss, startWave, withWorkspace } from "@wavekeep/service";
import { brandInputs, HOSPITALS, makeWorkspace, questionInputs } from "@wavekeep/service/seed";
import { testDatabase } from "@wavekeep/service/testing";
import { save } from "./save.ts";

const KILLS = Number(process.env.KILLS ?? 200);
const db = await testDatabase(6);
const ws = await makeWorkspace(db.owner, "kills", []);
const ctx: Ctx = { pool: db.pool, workspace: ws, role: "owner", account: null };
const project = await createProject(ctx, { name: "p", brands: brandInputs(HOSPITALS), questions: questionInputs() });
const boss = makeBoss(db.url);
await boss.start();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const start = (): ChildProcess =>
  spawn(process.execPath, [join(import.meta.dirname, "../apps/worker/src/main.ts")], {
    env: {
      ...process.env,
      DATABASE_URL: db.url,
      REPLAY_DELAY_MS: "900",
      SUPERVISE_SECONDS: "2",
      TEAMS: "2",
      BATCH: "5",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
const workers = [start(), start()];
let kills = 0;
let waves = 0;
let captured = 0;
let lost = 0;
let twice = 0;
let mismatch = 0;
let interrupted = 0;
await sleep(2500);
while (kills < KILLS) {
  const w = await startWave(ctx, boss, project, { engines: ["openai", "gemini"], repeats: 4, capMicros: 1e9 });
  waves++;
  for (;;) {
    const now = (await listWaves(ctx, project)).at(-1)!;
    if (now.status === "closed" && now.counted) break;
    if (kills < KILLS) {
      await sleep(900 + Math.random() * 900);
      const i = kills % 2;
      workers[i]!.kill("SIGKILL");
      kills++;
      workers[i] = start();
    } else await sleep(500);
  }
  const r = await withWorkspace(db.pool, ws, (tx) =>
    tx.query<{
      planned: number;
      done: number;
      failed: number;
      rows: number;
      distinct_rows: number;
      pending: number;
      wave_done: number;
      retried: number;
    }>(
      `select count(*)::int as planned, count(*) filter (where c.status = 'done')::int as done, count(*) filter (where c.status = 'failed')::int as failed, count(*) filter (where c.status = 'pending')::int as pending,
        count(a.capture_id)::int as rows, count(distinct a.capture_id)::int as distinct_rows, (select done from wave where id = $1) as wave_done, count(*) filter (where c.reserved_micros > 1000)::int as retried
       from capture c left join answer a on a.capture_id = c.id where c.wave_id = $1`,
      [w.wave],
    ),
  );
  const x = r.rows[0]!;
  captured += x.planned;
  lost += x.planned - x.done;
  twice += x.rows - x.distinct_rows;
  interrupted += x.retried;
  if (x.wave_done !== x.rows || x.pending) mismatch++;
}
for (const w of workers) w.kill("SIGKILL");
await boss.stop({ graceful: false });
save("kills", {
  kills,
  waves,
  captures: captured,
  "captures asked again after a kill": interrupted,
  lost,
  "counted twice": twice,
  "waves whose stored count differs": mismatch,
});
await db.drop();
