// Forced races between saving an answer and closing its wave, with and without the closer's lock.
import type { Ctx } from "@wavekeep/service";
import { closeWave, createProject, saveAnswer, startWave, withWorkspace } from "@wavekeep/service";
import { brandInputs, HOSPITALS, makeWorkspace, questionInputs } from "@wavekeep/service/seed";
import { testDatabase } from "@wavekeep/service/testing";
import { save } from "./save.ts";

const RACES = Number(process.env.RACES ?? 5000);
const db = await testDatabase(24);
const ws = await makeWorkspace(db.owner, "race", []);
const ctx: Ctx = { pool: db.pool, workspace: ws, role: "owner", account: null };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function race(project: string, lock: boolean): Promise<"agree" | "differ"> {
  const w = await startWave(ctx, null, project, { engines: ["openai"], repeats: 2, capMicros: 1e6 });
  const ids = (
    await withWorkspace(db.pool, ws, (tx) =>
      tx.query<{ id: number }>("select id from capture where wave_id = $1 order by id", [w.wave]),
    )
  ).rows;
  const answer = { workspace: ws, wave: w.wave, text: "x", model: "m", costMicros: 1, sources: [] };
  const writer = (async () => {
    await sleep(Math.random() * 3);
    await withWorkspace(db.pool, ws, async (tx) => {
      if (lock) await saveAnswer(tx, { ...answer, capture: ids[0]!.id });
      else {
        // The same writer without the share lock: look, then write.
        const open = await tx.query("select 1 from wave where id = $1 and status = 'open'", [w.wave]);
        if (open.rowCount) {
          const c = await tx.query<{ question_id: string }>(
            "update capture set status = 'done' where id = $1 and status = 'pending' returning question_id",
            [ids[0]!.id],
          );
          if (c.rowCount)
            await tx.query(
              "insert into answer (capture_id, workspace_id, wave_id, question_id, engine, text, model, cost_micros) values ($1, $2, $3, $4, 'openai', 'x', 'm', 1)",
              [ids[0]!.id, ws, w.wave, c.rows[0]!.question_id],
            );
        }
      }
      await sleep(Math.random() * 4);
    });
  })();
  const closer = (async () => {
    await sleep(Math.random() * 5);
    if (lock) await closeWave(db.pool, ws, w.wave, { early: true });
    // The same close without its lock: count, then write.
    else
      await withWorkspace(db.pool, ws, async (tx) => {
        const n = await tx.query<{ n: number }>(
          "select count(*)::int as n from capture where wave_id = $1 and status = 'done'",
          [w.wave],
        );
        await tx.query(
          "insert into wave_cell select wave_id, workspace_id, question_id, engine, count(*), count(*) filter (where status = 'done') from capture where wave_id = $1 group by 1, 2, 3, 4",
          [w.wave],
        );
        await tx.query("update wave set status = 'closed', planned = 2, done = $2, failed = 2 - $2 where id = $1", [
          w.wave,
          n.rows[0]!.n,
        ]);
      });
  })();
  // Without the locks the trigger still refuses a writer that starts after the close has committed.
  await Promise.all([
    writer.catch((e: { code?: string }) => {
      if (e.code !== "WK001") throw e;
    }),
    closer,
  ]);
  const r = await withWorkspace(db.pool, ws, (tx) =>
    tx.query<{ done: number; rows: number; cells: number }>(
      "select w.done, (select count(*)::int from answer where wave_id = w.id) as rows, (select sum(done)::int from wave_cell where wave_id = w.id) as cells from wave w where w.id = $1",
      [w.wave],
    ),
  );
  const x = r.rows[0]!;
  return x.done === x.rows && x.cells === x.rows ? "agree" : "differ";
}
async function many(n: number, lock: boolean): Promise<number> {
  let left = n;
  let differ = 0;
  await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const project = await createProject(ctx, {
        name: `p${lock}${i}`,
        brands: brandInputs(HOSPITALS.slice(0, 1)),
        questions: questionInputs(["a"], ["nurses"], 0),
      });
      while (left-- > 0) if ((await race(project, lock)) === "differ") differ++;
    }),
  );
  return differ;
}
save("late", {
  races: RACES,
  "differ with the locks": await many(RACES, true),
  "differ without": await many(Math.min(RACES, 1000), false),
  "races without": Math.min(RACES, 1000),
});
await db.drop();
