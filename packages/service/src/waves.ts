import type { Engine } from "@wavekeep/core";
import { classify, type EngineAdapter, Final } from "@wavekeep/engines/adapter";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { type Ctx, inWorkspace, staffOnly } from "./context.ts";
import { Conflict, Invalid, NotFound, type Tx, withWorkspace } from "./db.ts";

export const MAX_FAILURES = 3;
/** Anything that can insert jobs inside our transaction. */
export type Jobs = Pick<PgBoss, "insert" | "send">;
const inTx = (tx: Tx) => ({
  db: { executeSql: (text: string, values?: unknown[]) => tx.query(text, values as unknown[]) },
});

export interface WavePlan {
  engines: Engine[];
  repeats: number;
  capMicros: number;
}

/** What a wave would ask for and cost, shown before anyone starts it. */
export async function planWave(
  ctx: Ctx,
  projectId: string,
  plan: Pick<WavePlan, "engines" | "repeats">,
  adapters: Map<Engine, EngineAdapter>,
) {
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<{ n: number }>(
      "select count(*)::int as n from question_set_item i join project p on p.id = i.project_id and p.current_questions = i.version where p.id = $1",
      [projectId],
    );
    const questions = r.rows[0]!.n;
    const perEngine = questions * plan.repeats;
    const micros = plan.engines.reduce((s, e) => s + perEngine * (adapters.get(e)?.estimateMicros ?? 0), 0);
    return { questions, captures: perEngine * plan.engines.length, estimateMicros: micros };
  });
}

/** The wave, its captures and their jobs are created together or not at all. */
export async function startWave(
  ctx: Ctx,
  jobs: Jobs | null,
  projectId: string,
  plan: WavePlan,
): Promise<{ wave: string; seq: number; captures: number }> {
  staffOnly(ctx);
  if (plan.engines.length === 0 || new Set(plan.engines).size !== plan.engines.length)
    throw new Invalid("Pick each engine once.");
  if (!Number.isInteger(plan.repeats) || plan.repeats < 1 || plan.repeats > 20)
    throw new Invalid("Repeats must be between 1 and 20.");
  if (!(plan.capMicros > 0)) throw new Invalid("A wave needs a spending cap.");
  return inWorkspace(ctx, async (tx) => {
    const p = await tx.query<{ current_questions: number }>(
      "select current_questions from project where id = $1 for update",
      [projectId],
    );
    if (!p.rows[0]) throw new NotFound("No such project.");
    const open = await tx.query("select 1 from wave where project_id = $1 and status = 'open'", [projectId]);
    if (open.rowCount) throw new Conflict("A wave is already running.");
    const w = await tx.query<{ id: string; seq: number }>(
      `insert into wave (workspace_id, project_id, seq, questions_version, repeats, cap_micros)
       values ($1, $2, coalesce((select max(seq) from wave where project_id = $2), 0) + 1, $3, $4, $5) returning id, seq`,
      [ctx.workspace, projectId, p.rows[0].current_questions, plan.repeats, plan.capMicros],
    );
    const wave = w.rows[0]!;
    await tx.query("insert into wave_spend (wave_id, workspace_id) values ($1, $2)", [wave.id, ctx.workspace]);
    const c = await tx.query<{ id: number }>(
      `insert into capture (workspace_id, wave_id, question_id, engine, repeat)
       select $1, $2, i.question_id, e, r from question_set_item i, unnest($4::text[]) e, generate_series(1, $5::int) r
       where i.project_id = $3 and i.version = $6 returning id`,
      [ctx.workspace, wave.id, projectId, plan.engines, plan.repeats, p.rows[0].current_questions],
    );
    if (c.rowCount === 0) throw new Invalid("The question set is empty.");
    await tx.query(
      "insert into wave_engine (wave_id, workspace_id, engine, planned) select $1, $2, engine, count(*) from capture where wave_id = $1 group by engine",
      [wave.id, ctx.workspace],
    );
    if (jobs)
      await jobs.insert(
        "capture",
        c.rows.map((r) => ({ data: { workspace: ctx.workspace, capture: r.id } })),
        inTx(tx),
      );
    return { wave: wave.id, seq: wave.seq, captures: c.rows.length };
  });
}

export type CaptureOutcome = "saved" | "failed" | "already_done" | "too_late";

/**
 * Save one answer. The share lock holds the wave open until this commits, so a close either waits
 * for this answer and counts it, or goes first and this answer is refused.
 */
export async function saveAnswer(
  tx: Tx,
  a: {
    workspace: string;
    capture: number;
    wave: string;
    text: string;
    model: string;
    costMicros: number;
    sources: { url: string; original: string; title: string }[];
  },
): Promise<"saved" | "already_done" | "too_late"> {
  const w = await tx.query("select 1 from wave where id = $1 and status = 'open' for share", [a.wave]);
  if (w.rowCount === 0) return "too_late";
  const c = await tx.query<{ question_id: string; engine: string }>(
    "update capture set status = 'done', error = null where id = $1 and status = 'pending' returning question_id, engine",
    [a.capture],
  );
  const row = c.rows[0];
  if (!row) return "already_done";
  await tx.query(
    "insert into answer (capture_id, workspace_id, wave_id, question_id, engine, text, model, cost_micros) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      a.capture,
      a.workspace,
      a.wave,
      row.question_id,
      row.engine,
      a.text.replaceAll("\u0000", ""),
      a.model,
      a.costMicros,
    ],
  );
  for (const [ord, s] of a.sources.entries())
    await tx.query("insert into citation values ($1, $2, $3, $4, $5, $6, $7, $8)", [
      a.capture,
      a.workspace,
      a.wave,
      ord,
      s.url,
      new URL(s.url).hostname,
      s.original,
      s.title,
    ]);
  return "saved";
}

/** One planned capture. Safe to run twice: the row decides, not the job. */
export async function runCapture(
  pool: pg.Pool,
  workspace: string,
  capture: number,
  adapters: Map<Engine, EngineAdapter>,
): Promise<CaptureOutcome> {
  const start = await withWorkspace(pool, workspace, async (tx) => {
    const r = await tx.query<{
      status: string;
      wave_id: string;
      wave_status: string;
      seq: number;
      engine: Engine;
      repeat: number;
      question_id: string;
      text: string;
      cap_micros: number;
    }>(
      `select c.status, c.wave_id, w.status as wave_status, w.seq, c.engine, c.repeat, c.question_id, q.text, w.cap_micros
       from capture c join wave w on w.id = c.wave_id join question q on q.id = c.question_id where c.id = $1`,
      [capture],
    );
    const c = r.rows[0];
    if (!c) throw new NotFound("No such capture.");
    if (c.status !== "pending") return { skip: "already_done" as const };
    if (c.wave_status !== "open") return { skip: "too_late" as const };
    const adapter = adapters.get(c.engine);
    if (!adapter) return { fail: `no adapter for ${c.engine}` };
    const reserved = await tx.query(
      "update wave_spend set spent_micros = spent_micros + $2 where wave_id = $1 and spent_micros + $2 <= $3",
      [c.wave_id, adapter.estimateMicros, c.cap_micros],
    );
    if (reserved.rowCount === 0) return { fail: "spending cap reached" };
    await tx.query("update capture set reserved_micros = reserved_micros + $2 where id = $1", [
      capture,
      adapter.estimateMicros,
    ]);
    return { c, adapter };
  });
  if ("skip" in start) return start.skip!;
  if ("fail" in start) {
    await failCapture(pool, workspace, capture, start.fail!);
    return "failed";
  }
  const { c, adapter } = start;
  let answer: Awaited<ReturnType<EngineAdapter["ask"]>>;
  try {
    answer = await adapter.ask({ question: c.text, questionKey: c.question_id, wave: c.seq, repeat: c.repeat });
  } catch (e) {
    const err = classify(e);
    const tries = await withWorkspace(pool, workspace, async (tx) => {
      await tx.query("update wave_spend set spent_micros = spent_micros - $2 where wave_id = $1", [
        c.wave_id,
        adapter.estimateMicros,
      ]);
      const r = await tx.query<{ attempts: number }>(
        "update capture set attempts = attempts + 1, reserved_micros = reserved_micros - $2, error = $3 where id = $1 returning attempts",
        [capture, adapter.estimateMicros, err.message.slice(0, 300)],
      );
      return r.rows[0]!.attempts;
    });
    if (err instanceof Final || tries >= MAX_FAILURES) {
      await failCapture(pool, workspace, capture, err.message);
      return "failed";
    }
    throw err;
  }
  return withWorkspace(pool, workspace, async (tx) => {
    await tx.query("update wave_spend set spent_micros = spent_micros + $2 where wave_id = $1", [
      c.wave_id,
      answer.costMicros - adapter.estimateMicros,
    ]);
    return saveAnswer(tx, { workspace, capture, wave: c.wave_id, ...answer });
  });
}

export async function failCapture(pool: pg.Pool, workspace: string, capture: number, error: string): Promise<void> {
  await withWorkspace(pool, workspace, (tx) =>
    tx.query("update capture set status = 'failed', error = $2 where id = $1 and status = 'pending'", [
      capture,
      error.slice(0, 300),
    ]),
  );
}

/** The wave of a capture, if nothing in it is pending any more. */
export async function waveReadyToClose(pool: pg.Pool, workspace: string, capture: number): Promise<string | null> {
  return withWorkspace(pool, workspace, async (tx) => {
    const r = await tx.query<{ wave_id: string }>(
      `select c.wave_id from capture c join wave w on w.id = c.wave_id
       where c.id = $1 and w.status = 'open' and not exists (select 1 from capture x where x.wave_id = c.wave_id and x.status = 'pending')`,
      [capture],
    );
    return r.rows[0]?.wave_id ?? null;
  });
}

export interface Closed {
  planned: number;
  done: number;
  failed: number;
}

/**
 * Close a wave and store its counts. Three statements in this order:
 * lock the wave, count, write. The count has to be its own statement, because a statement that
 * waited for the lock still reads the snapshot it took before waiting.
 */
export async function closeWave(
  pool: pg.Pool,
  workspace: string,
  wave: string,
  o: { early?: boolean; after?: (tx: Tx) => Promise<void> } = {},
): Promise<Closed | null> {
  return withWorkspace(pool, workspace, async (tx) => {
    const w = await tx.query<{ status: string }>("select status from wave where id = $1 for update", [wave]);
    if (!w.rows[0]) throw new NotFound("No such wave.");
    if (w.rows[0].status === "closed") return null;
    const n = await tx.query<{ planned: number; done: number; pending: number }>(
      `select count(*)::int as planned, count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'pending')::int as pending from capture where wave_id = $1`,
      [wave],
    );
    const { planned, done, pending } = n.rows[0]!;
    if (pending > 0 && !o.early) return null;
    await tx.query(
      "update capture set status = 'failed', error = 'wave closed before it finished' where wave_id = $1 and status = 'pending'",
      [wave],
    );
    await tx.query(
      `insert into wave_cell select c.wave_id, c.workspace_id, c.question_id, c.engine, count(*), count(*) filter (where c.status = 'done')
       from capture c where c.wave_id = $1 group by 1, 2, 3, 4`,
      [wave],
    );
    await tx.query(
      `update wave_engine e set done = x.done, failed = e.planned - x.done, model = x.model
       from (select c.engine, count(a.capture_id)::int as done,
               case when count(distinct a.model) > 1 then 'mixed: ' || string_agg(distinct a.model, ', ') else coalesce(min(a.model), 'none') end as model
             from capture c left join answer a on a.capture_id = c.id where c.wave_id = $1 group by c.engine) x
       where e.wave_id = $1 and e.engine = x.engine`,
      [wave],
    );
    await tx.query(
      "update wave set status = 'closed', planned = $2::int, done = $3::int, failed = $2::int - $3::int where id = $1",
      [wave, planned, done],
    );
    if (o.after) await o.after(tx);
    return { planned, done, failed: planned - done };
  });
}

export async function listWaves(ctx: Ctx, projectId: string) {
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<{
      id: string;
      seq: number;
      status: "open" | "closed";
      repeats: number;
      questions_version: number;
      cap_micros: number;
      spent_micros: number;
      planned: number;
      done: number;
      failed: number;
      engines: { engine: Engine; planned: number; done: number; model: string | null }[];
      counted: boolean;
    }>(
      `select w.id, w.seq, w.status, w.repeats, w.questions_version, w.cap_micros, s.spent_micros,
        coalesce(w.planned, c.planned) as planned, coalesce(w.done, c.done) as done, coalesce(w.failed, c.failed) as failed,
        (select json_agg(json_build_object('engine', e.engine, 'planned', e.planned, 'model', e.model,
           'done', coalesce(e.done, (select count(*) from capture k where k.wave_id = w.id and k.engine = e.engine and k.status = 'done'))) order by e.engine) from wave_engine e where e.wave_id = w.id) as engines,
        exists (select 1 from publication b join project p on p.id = w.project_id where b.wave_id = w.id and b.names_version = p.current_names and b.detector = p.current_detector) as counted
       from wave w join wave_spend s on s.wave_id = w.id
       left join lateral (select count(*)::int as planned, count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'failed')::int as failed from capture where wave_id = w.id and w.status = 'open') c on true
       where w.project_id = $1 order by w.seq`,
      [projectId],
    );
    return r.rows;
  });
}
