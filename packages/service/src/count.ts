import { type BrandName, CURRENT_DETECTOR, DETECTORS, type Detector, hostBelongsTo } from "@wavekeep/core";
import { type Judge, ruleJudge } from "@wavekeep/engines/rule";
import type pg from "pg";
import { type Ctx, inWorkspace, staffOnly } from "./context.ts";
import { Invalid, NotFound, withWorkspace } from "./db.ts";

export interface CountingRules {
  detectors: ReadonlyMap<number, Detector>;
  /** Which judge goes with which detector version. One number covers both. */
  judges: ReadonlyMap<number, Judge>;
}
export const RULES: CountingRules = {
  detectors: DETECTORS,
  judges: new Map([...DETECTORS.keys()].map((v) => [v, ruleJudge])),
};
export { CURRENT_DETECTOR };

const BATCH = 1000;

/**
 * Find mentions in every answer of a closed wave and write the counts. Safe to repeat: rows land with
 * "on conflict do nothing", and the publication row, written last, is what makes the numbers readable.
 */
export async function countWave(
  pool: pg.Pool,
  workspace: string,
  wave: string,
  names: number,
  detector: number,
  rules: CountingRules = RULES,
): Promise<void> {
  const find = rules.detectors.get(detector);
  const judge = rules.judges.get(detector);
  if (!find || !judge) throw new Invalid(`No detector version ${detector}.`);
  const set = await withWorkspace(pool, workspace, async (tx) => {
    const w = await tx.query<{ project_id: string; status: string }>(
      "select project_id, status from wave where id = $1",
      [wave],
    );
    if (!w.rows[0]) throw new NotFound("No such wave.");
    if (w.rows[0].status !== "closed") throw new Invalid("Only a closed wave is counted.");
    const project = w.rows[0].project_id;
    if (
      (
        await tx.query("select 1 from publication where wave_id = $1 and names_version = $2 and detector = $3", [
          wave,
          names,
          detector,
        ])
      ).rowCount
    )
      return null;
    const n = await tx.query<BrandName & { label: string }>(
      `select n.brand_id as brand, n.name, n.needs_context as "needsContext", b.label from name_set_name n join brand b on b.id = n.brand_id where n.project_id = $1 and n.version = $2`,
      [project, names],
    );
    const d = await tx.query<{ brand: string; domain: string }>(
      "select brand_id as brand, domain from name_set_domain where project_id = $1 and version = $2",
      [project, names],
    );
    if (
      (await tx.query("select 1 from name_set where project_id = $1 and version = $2", [project, names])).rowCount === 0
    )
      throw new NotFound("No such name set.");
    return { project, names: n.rows, domains: d.rows };
  });
  if (!set) return;
  const label = new Map(set.names.map((n) => [n.brand, n.label]));
  let after = 0;
  for (;;) {
    const rows = await withWorkspace(
      pool,
      workspace,
      async (tx) =>
        (
          await tx.query<{ id: number; text: string; hosts: string[] }>(
            `select a.capture_id as id, a.text, coalesce((select array_agg(distinct c.host) from citation c where c.answer_id = a.capture_id), '{}') as hosts
             from answer a where a.wave_id = $1 and a.capture_id > $2 order by a.capture_id limit ${BATCH}`,
            [wave, after],
          )
        ).rows,
    );
    if (rows.length === 0) break;
    after = rows.at(-1)!.id;
    const m = { answer: [] as number[], brand: [] as string[], start: [] as number[], quote: [] as string[] };
    const rec = { answer: [] as number[], brand: [] as string[] };
    const own = { answer: [] as number[], brand: [] as string[] };
    for (const row of rows) {
      const found = find(row.text, set.names);
      const byBrand = Map.groupBy(found, (x) => x.brand);
      for (const x of found) {
        m.answer.push(row.id);
        m.brand.push(x.brand);
        m.start.push(x.start);
        m.quote.push(x.quote);
      }
      for (const [brand, quotes] of byBrand)
        if (await judge.recommends(row.text, label.get(brand)!, quotes)) {
          rec.answer.push(row.id);
          rec.brand.push(brand);
        }
      const owners = new Set(
        set.domains.filter((d) => row.hosts.some((h) => hostBelongsTo(h, d.domain))).map((d) => d.brand),
      );
      for (const brand of owners) {
        own.answer.push(row.id);
        own.brand.push(brand);
      }
    }
    await withWorkspace(pool, workspace, async (tx) => {
      await tx.query(
        "insert into mention select a, $1, $2, $3, $4, b, s, q from unnest($5::bigint[], $6::uuid[], $7::int[], $8::text[]) t(a, b, s, q) on conflict do nothing",
        [workspace, wave, names, detector, m.answer, m.brand, m.start, m.quote],
      );
      await tx.query(
        "insert into recommendation select a, $1, $2, $3, $4, b from unnest($5::bigint[], $6::uuid[]) t(a, b) on conflict do nothing",
        [workspace, wave, names, detector, rec.answer, rec.brand],
      );
      await tx.query(
        "insert into own_citation select a, $1, $2, $3, b from unnest($4::bigint[], $5::uuid[]) t(a, b) on conflict do nothing",
        [workspace, wave, names, own.answer, own.brand],
      );
    });
  }
  await withWorkspace(pool, workspace, async (tx) => {
    await tx.query(
      `insert into brand_cell
       select $1, $2, $3, $4, x.brand_id, a.question_id, a.engine,
         count(distinct x.answer_id) filter (where x.kind = 'n'), count(distinct x.answer_id) filter (where x.kind = 'r'), count(distinct x.answer_id) filter (where x.kind = 'c')
       from (
         select brand_id, answer_id, 'n' as kind from mention where wave_id = $1 and names_version = $3 and detector = $4
         union all select brand_id, answer_id, 'r' from recommendation where wave_id = $1 and names_version = $3 and detector = $4
         union all select brand_id, answer_id, 'c' from own_citation where wave_id = $1 and names_version = $3
       ) x join answer a on a.capture_id = x.answer_id
       group by x.brand_id, a.question_id, a.engine on conflict do nothing`,
      [wave, workspace, names, detector],
    );
    await tx.query("insert into publication values ($1, $2, $3, $4, $5) on conflict do nothing", [
      wave,
      workspace,
      set.project,
      names,
      detector,
    ]);
  });
}

/**
 * Move a project to a name set and detector. Every closed wave is counted first, then all of them
 * switch in one transaction. A wave that closes meanwhile sends the loop round again.
 */
export async function publish(
  ctx: Ctx,
  projectId: string,
  names: number,
  detector: number,
  rules: CountingRules = RULES,
): Promise<{ waves: number }> {
  staffOnly(ctx);
  for (let round = 0; round < 50; round++) {
    const missing = await inWorkspace(ctx, async (tx) => {
      const p = await tx.query("select 1 from project where id = $1 for update", [projectId]);
      if (p.rowCount === 0) throw new NotFound("No such project.");
      const r = await tx.query<{ id: string }>(
        `select w.id from wave w where w.project_id = $1 and w.status = 'closed'
         and not exists (select 1 from publication b where b.wave_id = w.id and b.names_version = $2 and b.detector = $3) for share`,
        [projectId, names, detector],
      );
      if (r.rows.length === 0)
        await tx.query("update project set current_names = $2, current_detector = $3 where id = $1", [
          projectId,
          names,
          detector,
        ]);
      return r.rows;
    });
    if (missing.length === 0) {
      const n = await inWorkspace(ctx, (tx) =>
        tx.query<{ n: number }>("select count(*)::int as n from wave where project_id = $1 and status = 'closed'", [
          projectId,
        ]),
      );
      return { waves: n.rows[0]!.n };
    }
    for (const w of missing) await countWave(ctx.pool, ctx.workspace, w.id, names, detector, rules);
  }
  throw new Invalid("Waves kept closing during the count.");
}
