import type { Engine } from "@wavekeep/core";
import type { EngineAdapter } from "@wavekeep/engines/adapter";
import type pg from "pg";
import { PgBoss } from "pg-boss";
import { type CountingRules, countWave, RULES } from "./count.ts";
import { withWorkspace } from "./db.ts";
import { closeWave, failCapture, runCapture, waveReadyToClose } from "./waves.ts";

interface CaptureJob {
  workspace: string;
  capture: number;
}
interface WaveJob {
  workspace: string;
  wave: string;
}

export function makeBoss(url: string, o: { supervise?: boolean; intervalSeconds?: number } = {}): PgBoss {
  const boss = new PgBoss({
    connectionString: url,
    migrate: false,
    createSchema: false,
    schedule: false,
    supervise: o.supervise ?? false,
    ...(o.intervalSeconds
      ? { superviseIntervalSeconds: o.intervalSeconds, monitorIntervalSeconds: o.intervalSeconds }
      : {}),
    max: 4,
  });
  boss.on("error", (e) => console.error("queue:", e.message));
  return boss;
}

async function settle(boss: PgBoss, pool: pg.Pool, job: CaptureJob): Promise<void> {
  const wave = await waveReadyToClose(pool, job.workspace, job.capture);
  if (wave) await boss.send("close", { workspace: job.workspace, wave });
}

export async function work(
  boss: PgBoss,
  pool: pg.Pool,
  adapters: Map<Engine, EngineAdapter>,
  o: { batch?: number; teams?: number; rules?: CountingRules } = {},
): Promise<void> {
  for (let i = 0; i < (o.teams ?? 4); i++) {
    await boss.work<CaptureJob>(
      "capture",
      { batchSize: o.batch ?? 10, pollingIntervalSeconds: 0.5, includeMetadata: true },
      async (jobs) => {
        const done = await Promise.allSettled(
          jobs.map(async (job) => {
            // The last delivery failing for reasons of ours still has to end the capture.
            if (job.retryCount >= job.retryLimit)
              await failCapture(pool, job.data.workspace, job.data.capture, "worker failed repeatedly");
            else await runCapture(pool, job.data.workspace, job.data.capture, adapters);
            await settle(boss, pool, job.data);
          }),
        );
        // The whole batch comes back. Finished captures are skipped by their row, so that costs one read each.
        const failed = done.find((d) => d.status === "rejected");
        if (failed) throw failed.reason;
      },
    );
  }
  await boss.work<WaveJob>("close", { pollingIntervalSeconds: 0.5 }, async ([job]) => {
    const { workspace, wave } = job!.data;
    await closeWave(pool, workspace, wave, {
      after: async (tx) => {
        await boss.send(
          "count",
          { workspace, wave },
          { db: { executeSql: (text, values) => tx.query(text, values as unknown[]) } },
        );
      },
    });
  });
  await boss.work<WaveJob>("count", { pollingIntervalSeconds: 0.5 }, async ([job]) => {
    const { workspace, wave } = job!.data;
    const p = await withWorkspace(pool, workspace, (tx) =>
      tx.query<{ n: number; d: number }>(
        "select p.current_names as n, p.current_detector as d from project p join wave w on w.project_id = p.id where w.id = $1",
        [wave],
      ),
    );
    if (p.rows[0]) await countWave(pool, workspace, wave, p.rows[0].n, p.rows[0].d, o.rules ?? RULES);
  });
}
