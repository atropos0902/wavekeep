import {
  type Comparison,
  compareWaves,
  type Engine,
  type Filter,
  METRICS,
  type Metric,
  type Pin,
  pinKey,
  type Rate,
  type WaveData,
  waveRate,
} from "@wavekeep/core";
import { type Ctx, inWorkspace, staffOnly } from "./context.ts";
import { Invalid, NotFound, type Tx } from "./db.ts";

/** The one query layer. Pages, API and MCP server all read through this file. */

export interface ProjectRow {
  id: string;
  name: string;
  names: number;
  detector: number;
  questions: number;
}

export async function listProjects(ctx: Ctx): Promise<ProjectRow[]> {
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<ProjectRow>(
      "select id, name, current_names as names, current_detector as detector, current_questions as questions from project order by name",
    );
    return r.rows;
  });
}

export async function getProject(ctx: Ctx, id: string): Promise<ProjectRow> {
  const p = (await listProjects(ctx)).find((x) => x.id === id);
  if (!p) throw new NotFound("No such project.");
  return p;
}

interface Ready {
  id: string;
  seq: number;
  questions: number;
}

/** A pin is readable when its wave is closed and counted under exactly those versions. */
async function pinnedWave(tx: Tx, project: string, pin: Pin): Promise<Ready> {
  const r = await tx.query<Ready>(
    `select w.id, w.seq, w.questions_version as questions from wave w join publication b on b.wave_id = w.id and b.names_version = $3 and b.detector = $4
     where w.project_id = $1 and w.seq = $2 and w.status = 'closed' and w.questions_version = $5`,
    [project, pin.wave, pin.names, pin.detector, pin.questions],
  );
  if (!r.rows[0]) throw new NotFound("These numbers haven't been counted.");
  return r.rows[0];
}

/** Every wave readable under the given name set and detector, oldest first. */
export async function readablePins(ctx: Ctx, project: string, names: number, detector: number): Promise<Pin[]> {
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<{ seq: number; questions: number }>(
      `select w.seq, w.questions_version as questions from wave w join publication b on b.wave_id = w.id where w.project_id = $1 and b.names_version = $2 and b.detector = $3 order by w.seq`,
      [project, names, detector],
    );
    return r.rows.map((w) => ({ wave: w.seq, questions: w.questions, names, detector }));
  });
}

export async function latestPin(ctx: Ctx, project: string): Promise<Pin | null> {
  const p = await getProject(ctx, project);
  return (await readablePins(ctx, project, p.names, p.detector)).at(-1) ?? null;
}

const filterKey = (f: Filter): string =>
  JSON.stringify([f.kind, [...(f.engines ?? [])].sort(), [...(f.families ?? [])].sort()]);

/** All brands and metrics of one wave, one query. */
async function loadWave(tx: Tx, project: string, pin: Pin, filter: Filter) {
  const w = await pinnedWave(tx, project, pin);
  const engines = (
    await tx.query<{ engine: string; model: string; planned: number; done: number }>(
      "select engine, coalesce(model, 'none') as model, planned, coalesce(done, 0) as done from wave_engine where wave_id = $1 order by engine",
      [w.id],
    )
  ).rows.filter((e) => !filter.engines?.length || filter.engines.includes(e.engine as Engine));
  const base = await tx.query<{ family: string; question: string; engine: string; planned: number; done: number }>(
    `select q.family_id as family, c.question_id as question, c.engine, c.planned, c.done
     from wave_cell c join question q on q.id = c.question_id
     join question_set_item i on i.question_id = c.question_id and i.project_id = $2 and i.version = $3
     where c.wave_id = $1 and i.kind = $4 and ($5::text[] is null or c.engine = any($5)) and ($6::uuid[] is null or q.family_id = any($6))
     order by c.question_id, c.engine`,
    [
      w.id,
      project,
      pin.questions,
      filter.kind,
      filter.engines?.length ? filter.engines : null,
      filter.families?.length ? filter.families : null,
    ],
  );
  const hits = await tx.query<{
    brand: string;
    question: string;
    engine: string;
    named: number;
    recommended: number;
    cited: number;
  }>(
    "select brand_id as brand, question_id as question, engine, named, recommended, cited from brand_cell where wave_id = $1 and names_version = $2 and detector = $3",
    [w.id, pin.names, pin.detector],
  );
  const table = new Map<string, { named: number; recommended: number; cited: number }>();
  for (const h of hits.rows) table.set(`${h.brand}|${h.question}|${h.engine}`, h);
  const brands = (
    await tx.query<{ id: string; label: string; own: boolean }>(
      "select id, label, is_own as own from brand where project_id = $1 order by is_own desc, label",
      [project],
    )
  ).rows;
  const data = (brand: string, metric: Metric): WaveData => ({
    key: `${pinKey(pin)}|${filterKey(filter)}|${brand}|${metric}`,
    engines,
    cells: base.rows.map((c) => ({ ...c, hits: table.get(`${brand}|${c.question}|${c.engine}`)?.[metric] ?? 0 })),
  });
  return { wave: w, engines, brands, data };
}

export interface OverviewBrand {
  id: string;
  label: string;
  own: boolean;
  rates: Record<Metric, Rate>;
  change: Record<Metric, Comparison> | null;
}
export interface Overview {
  pin: Pin;
  previous: Pin | null;
  engines: { engine: string; model: string; planned: number; done: number }[];
  brands: OverviewBrand[];
}

/**
 * A closed wave under a fixed pin never changes, so its numbers are kept and never invalidated.
 * The workspace is part of the key: the same pin text exists in every workspace.
 */
const kept = new Map<string, Promise<unknown>>();
const KEEP = 2000;
/** The promise is kept, so fifty people opening a fresh wave at once wait for one calculation. */
function keep<T>(key: string, make: () => Promise<T>): Promise<T> {
  const found = kept.get(key) as Promise<T> | undefined;
  if (found) {
    kept.delete(key);
    kept.set(key, found);
    return found;
  }
  const made = make();
  kept.set(key, made);
  made.catch(() => kept.delete(key));
  if (kept.size > KEEP) kept.delete(kept.keys().next().value!);
  return made;
}
export const forgetEverything = (): void => kept.clear();
export const keptCount = (): number => kept.size;

async function previousPin(ctx: Ctx, project: string, pin: Pin): Promise<Pin | null> {
  return (await readablePins(ctx, project, pin.names, pin.detector)).filter((p) => p.wave < pin.wave).at(-1) ?? null;
}

export async function overview(ctx: Ctx, project: string, pin: Pin, filter: Filter): Promise<Overview> {
  staffOnly(ctx);
  const previous = await previousPin(ctx, project, pin);
  return keep(
    ["overview", ctx.workspace, project, pinKey(pin), previous && pinKey(previous), filterKey(filter)].join("|"),
    () =>
      inWorkspace(ctx, async (tx) => {
        const now = await loadWave(tx, project, pin, filter);
        const then = previous ? await loadWave(tx, project, previous, filter) : null;
        const each = <T>(f: (m: Metric) => T): Record<Metric, T> => ({
          named: f("named"),
          recommended: f("recommended"),
          cited: f("cited"),
        });
        return {
          pin,
          previous,
          engines: now.engines,
          brands: now.brands.map((b) => ({
            ...b,
            rates: each((m) => waveRate(now.data(b.id, m))),
            change: then ? each((m) => compareWaves(then.data(b.id, m), now.data(b.id, m))) : null,
          })),
        };
      }),
  );
}

export interface NumberRow {
  pin: string;
  brand: string;
  metric: Metric;
  planned: number;
  done: number;
  hits: number;
  rate: number | null;
  low: number | null;
  high: number | null;
  asRange: boolean;
}

/** One number, the way the page, the API and the MCP server all show it. */
export async function number(
  ctx: Ctx,
  project: string,
  pin: Pin,
  brand: string,
  metric: Metric,
  filter: Filter,
): Promise<NumberRow> {
  staffOnly(ctx);
  const rate = await keep(
    ["number", ctx.workspace, project, pinKey(pin), brand, metric, filterKey(filter)].join("|"),
    () =>
      inWorkspace(ctx, async (tx) => {
        const w = await loadWave(tx, project, pin, filter);
        if (!w.brands.some((b) => b.id === brand)) throw new NotFound("No such brand.");
        return waveRate(w.data(brand, metric));
      }),
  );
  const ci = rate.asRange ? rate.bounds : rate.interval;
  return {
    pin: pinKey(pin),
    brand,
    metric,
    planned: rate.planned,
    done: rate.done,
    hits: rate.hits,
    rate: rate.rate,
    low: ci?.[0] ?? null,
    high: ci?.[1] ?? null,
    asRange: rate.asRange,
  };
}

export interface CompareResult {
  brand: { id: string; label: string };
  metric: Metric;
  before: { pin: Pin; rate: Rate };
  after: { pin: Pin; rate: Rate };
  result: Comparison;
  families: Record<string, string>;
}

export async function compare(
  ctx: Ctx,
  project: string,
  a: Pin,
  b: Pin,
  brand: string,
  metric: Metric,
  filter: Filter,
): Promise<CompareResult> {
  staffOnly(ctx);
  if (a.names !== b.names || a.detector !== b.detector)
    throw new Invalid("Both waves must be counted with the same names and detector.");
  return keep(
    ["compare", ctx.workspace, project, pinKey(a), pinKey(b), brand, metric, filterKey(filter)].join("|"),
    () =>
      inWorkspace(ctx, async (tx) => {
        const x = await loadWave(tx, project, a, filter);
        const y = await loadWave(tx, project, b, filter);
        const found = x.brands.find((r) => r.id === brand);
        if (!found) throw new NotFound("No such brand.");
        const fam = await tx.query<{ id: string; label: string }>(
          "select id, label from family where project_id = $1",
          [project],
        );
        return {
          brand: { id: found.id, label: found.label },
          metric,
          before: { pin: a, rate: waveRate(x.data(brand, metric)) },
          after: { pin: b, rate: waveRate(y.data(brand, metric)) },
          result: compareWaves(x.data(brand, metric), y.data(brand, metric)),
          families: Object.fromEntries(fam.rows.map((f) => [f.id, f.label])),
        };
      }),
  );
}

export const OUTCOMES = ["hit", "miss", "all"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface EvidenceAnswer {
  id: number;
  question: string;
  family: string;
  engine: string;
  repeat: number;
  model: string;
  text: string;
  hit: boolean;
  mentions: { start: number; quote: string; brand: string }[];
  sources: { url: string; host: string; title: string }[];
}

/** The answers behind a number, counted from the saved answers and not from the stored counts. */
export async function evidence(
  ctx: Ctx,
  project: string,
  pin: Pin,
  q: {
    brand: string;
    metric: Metric;
    outcome: Outcome;
    filter: Filter;
    after?: number;
    limit?: number;
    countOnly?: boolean;
  },
): Promise<{ total: number; answers: EvidenceAnswer[]; next: number | null }> {
  staffOnly(ctx);
  if (!METRICS.includes(q.metric)) throw new Invalid("No such metric.");
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
  return inWorkspace(ctx, async (tx) => {
    const w = await pinnedWave(tx, project, pin);
    if ((await tx.query("select 1 from brand where id = $1 and project_id = $2", [q.brand, project])).rowCount === 0)
      throw new NotFound("No such brand.");
    const behind =
      q.metric === "named"
        ? "select answer_id from mention where wave_id = $1 and names_version = $7 and detector = $8 and brand_id = $9"
        : q.metric === "recommended"
          ? "select answer_id from recommendation where wave_id = $1 and names_version = $7 and detector = $8 and brand_id = $9"
          : "select answer_id from own_citation where wave_id = $1 and names_version = $7 and brand_id = $9 and $8::int is not null";
    const want = q.outcome === "all" ? "true" : q.outcome === "hit" ? "h.answer_id is not null" : "h.answer_id is null";
    const from = `from answer a join question qu on qu.id = a.question_id join family f on f.id = qu.family_id
      join question_set_item i on i.question_id = a.question_id and i.project_id = $2 and i.version = $3 and i.kind = $4
      left join (select distinct answer_id from (${behind}) z) h on h.answer_id = a.capture_id
      where a.wave_id = $1 and ($5::text[] is null or a.engine = any($5)) and ($6::uuid[] is null or qu.family_id = any($6)) and ${want}`;
    const args = [
      w.id,
      project,
      pin.questions,
      q.filter.kind,
      q.filter.engines?.length ? q.filter.engines : null,
      q.filter.families?.length ? q.filter.families : null,
      pin.names,
      pin.detector,
      q.brand,
    ];
    const total = (await tx.query<{ n: number }>(`select count(*)::int as n ${from}`, args)).rows[0]!.n;
    if (q.countOnly) return { total, answers: [], next: null };
    const rows = (
      await tx.query<{
        id: number;
        question: string;
        family: string;
        engine: string;
        repeat: number;
        model: string;
        text: string;
        hit: boolean;
      }>(
        `select a.capture_id as id, qu.text as question, f.label as family, a.engine, (select repeat from capture c where c.id = a.capture_id) as repeat, a.model, a.text, h.answer_id is not null as hit
         ${from} and a.capture_id > $10 order by a.capture_id limit $11`,
        [...args, q.after ?? 0, limit + 1],
      )
    ).rows;
    const page = rows.slice(0, limit);
    const ids = page.map((r) => r.id);
    const ms = (
      await tx.query<{ answer_id: number; start: number; quote: string; brand: string }>(
        "select answer_id, start, quote, brand_id as brand from mention where answer_id = any($1) and names_version = $2 and detector = $3 order by answer_id, start",
        [ids, pin.names, pin.detector],
      )
    ).rows;
    const cs = (
      await tx.query<{ answer_id: number; url: string; host: string; title: string }>(
        "select answer_id, url, host, title from citation where answer_id = any($1) order by answer_id, ord",
        [ids],
      )
    ).rows;
    return {
      total,
      next: rows.length > limit ? page.at(-1)!.id : null,
      answers: page.map((r) => ({
        ...r,
        mentions: ms.filter((m) => m.answer_id === r.id).map(({ start, quote, brand }) => ({ start, quote, brand })),
        sources: cs.filter((c) => c.answer_id === r.id).map(({ url, host, title }) => ({ url, host, title })),
      })),
    };
  });
}

export async function sources(ctx: Ctx, project: string, pin: Pin, filter: Filter) {
  staffOnly(ctx);
  return inWorkspace(ctx, async (tx) => {
    const w = await pinnedWave(tx, project, pin);
    const args = [
      w.id,
      project,
      pin.questions,
      filter.kind,
      filter.engines?.length ? filter.engines : null,
      filter.families?.length ? filter.families : null,
      pin.names,
    ];
    const within = `answer a join question qu on qu.id = a.question_id join question_set_item i on i.question_id = a.question_id and i.project_id = $2 and i.version = $3 and i.kind = $4
      where a.wave_id = $1 and ($5::text[] is null or a.engine = any($5)) and ($6::uuid[] is null or qu.family_id = any($6))`;
    const total = (
      await tx.query<{ answers: number; cited: number }>(
        `select count(*)::int as answers, count(*) filter (where exists (select 1 from citation c where c.answer_id = a.capture_id))::int as cited from ${within} and $7::int is not null`,
        args,
      )
    ).rows[0]!;
    const hosts = await tx.query<{ host: string; answers: number; pages: number; owner: string | null; own: boolean }>(
      `select c.host, count(distinct c.answer_id)::int as answers, count(distinct c.url)::int as pages, o.label as owner, coalesce(o.is_own, false) as own
       from citation c join (select a.capture_id from ${within}) k on k.capture_id = c.answer_id
       left join lateral (select b.label, b.is_own from name_set_domain d join brand b on b.id = d.brand_id where d.project_id = $2 and d.version = $7 and (c.host = d.domain or c.host like '%.' || d.domain) limit 1) o on true
       group by c.host, o.label, o.is_own order by 2 desc, 1 limit 200`,
      args,
    );
    const pages = await tx.query<{ url: string; host: string; title: string; answers: number }>(
      `select c.url, c.host, min(c.title) as title, count(distinct c.answer_id)::int as answers from citation c join (select a.capture_id from ${within}) k on k.capture_id = c.answer_id
       where $7::int is not null group by c.url, c.host order by 4 desc, 1 limit 500`,
      args,
    );
    return { ...total, hosts: hosts.rows, pages: pages.rows };
  });
}

export async function questions(ctx: Ctx, project: string, version: number) {
  staffOnly(ctx);
  await getProject(ctx, project);
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<{ id: string; text: string; kind: "core" | "explore"; family_id: string; family: string }>(
      `select q.id, q.text, i.kind, f.id as family_id, f.label as family from question_set_item i join question q on q.id = i.question_id join family f on f.id = q.family_id
       where i.project_id = $1 and i.version = $2 order by f.label, i.kind, q.text`,
      [project, version],
    );
    const versions = await tx.query<{ version: number; note: string }>(
      "select version, note from question_set where project_id = $1 order by version",
      [project],
    );
    return { items: r.rows, versions: versions.rows };
  });
}

/** Rate per wave for the trend line, with a break wherever two neighbours don't compare. */
export async function trend(
  ctx: Ctx,
  project: string,
  names: number,
  detector: number,
  brand: string,
  metric: Metric,
  filter: Filter,
) {
  const pins = await readablePins(ctx, project, names, detector);
  const points: { pin: Pin; rate: Rate; link: Comparison | null }[] = [];
  for (const [i, pin] of pins.entries()) {
    const prev = pins[i - 1];
    const c = prev ? await compare(ctx, project, prev, pin, brand, metric, filter) : null;
    const rate = c
      ? c.after.rate
      : await inWorkspace(ctx, async (tx) => waveRate((await loadWave(tx, project, pin, filter)).data(brand, metric)));
    points.push({ pin, rate, link: c?.result ?? null });
  }
  return points;
}
