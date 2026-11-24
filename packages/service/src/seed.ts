import { type Engine, seeded } from "@wavekeep/core";
import { type EngineAdapter, type RecordingSource, replayAdapter } from "@wavekeep/engines";
import type pg from "pg";
import { hashPassword } from "./auth.ts";
import type { Ctx } from "./context.ts";
import { CURRENT_DETECTOR, countWave, publish } from "./count.ts";
import { withWorkspace } from "./db.ts";
import { approveReport, draftReport, submitReport } from "./reports.ts";
import { type BrandInput, createProject, type QuestionInput } from "./setup.ts";
import { FAMILIES, HOSPITALS, type Profile, ROLES, syntheticSource, type WaveShape } from "./synthetic.ts";
import { closeWave, runCapture, startWave } from "./waves.ts";

export * from "./synthetic.ts";

export async function makeWorkspace(
  owner: pg.Pool,
  name: string,
  people: { email: string; name: string; role: "owner" | "analyst" | "client" }[],
): Promise<string> {
  const w = await owner.query<{ id: string }>("insert into workspace (name) values ($1) returning id", [name]);
  const id = w.rows[0]!.id;
  for (const p of people)
    await owner.query(
      "insert into account (workspace_id, email, name, role, password_hash) values ($1, $2, $3, $4, $5)",
      [id, p.email, p.name, p.role, hashPassword("demo")],
    );
  return id;
}

export function brandInputs(profiles: Profile[]): BrandInput[] {
  return profiles.map((p, i) => ({
    label: p.brand,
    own: i === 0,
    names: [...new Set(p.forms.map((f) => f.replace("’", "'")))].map((name) => ({
      name,
      needsContext: ["Summit", "Beacon"].includes(name),
    })),
    domains: [p.domain],
  }));
}

export function questionInputs(families = FAMILIES, roles = ROLES, explore = 10): QuestionInput[] {
  const core = families.flatMap((family) =>
    roles.map(
      (role): QuestionInput => ({
        family,
        text: `Which hospitals near the city are good for ${role} who care about ${family.toLowerCase()}?`,
        kind: "core",
      }),
    ),
  );
  const extra = families.slice(0, explore).map(
    (family): QuestionInput => ({
      family,
      text: `I'm changing hospitals next month. Who handles ${family.toLowerCase()} well?`,
      kind: "explore",
    }),
  );
  return [...core, ...extra];
}

export async function familyLookup(ctx: Ctx, project: string): Promise<Map<string, string>> {
  const r = await withWorkspace(ctx.pool, ctx.workspace, (tx) =>
    tx.query<{ id: string; label: string }>(
      "select q.id, f.label from question q join family f on f.id = q.family_id where q.project_id = $1",
      [project],
    ),
  );
  return new Map(r.rows.map((x) => [x.id, x.label]));
}

export const replaySet = (
  engines: Engine[],
  source: RecordingSource,
  delay?: () => number,
): Map<Engine, EngineAdapter> => new Map(engines.map((e) => [e, replayAdapter(e, source, delay)]));

/** Run a whole wave in this process: start, capture, close. */
export async function runWave(
  ctx: Ctx,
  project: string,
  engines: Engine[],
  repeats: number,
  source: RecordingSource,
): Promise<{ wave: string; seq: number }> {
  const w = await startWave(ctx, null, project, { engines, repeats, capMicros: 50_000_000 });
  const ids = await withWorkspace(ctx.pool, ctx.workspace, (tx) =>
    tx.query<{ id: number }>("select id from capture where wave_id = $1 order by id", [w.wave]),
  );
  const adapters = replaySet(engines, source);
  const queue = ids.rows.map((r) => r.id);
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift())
        await runCapture(ctx.pool, ctx.workspace, id, adapters);
    }),
  );
  await closeWave(ctx.pool, ctx.workspace, w.wave);
  return w;
}

export async function seedDemo(owner: pg.Pool, pool: pg.Pool): Promise<void> {
  if ((await owner.query("select 1 from workspace limit 1")).rowCount) return;
  const north = await makeWorkspace(owner, "Northlight Agency", [
    { email: "owner@northlight.example", name: "Northlight owner", role: "owner" },
    { email: "analyst@northlight.example", name: "Northlight analyst", role: "analyst" },
    { email: "client@northlight.example", name: "Saint Mary's client", role: "client" },
  ]);
  const tide = await makeWorkspace(owner, "Tidewater Talent", [
    { email: "owner@tidewater.example", name: "Tidewater owner", role: "owner" },
  ]);
  const ctxFor = async (workspace: string): Promise<Ctx> => {
    const a = await owner.query<{ id: string }>("select id from account where workspace_id = $1 and role = 'owner'", [
      workspace,
    ]);
    return { pool, workspace, role: "owner", account: a.rows[0]!.id };
  };
  const n = await ctxFor(north);
  const engines: Engine[] = ["openai", "gemini"];

  const mary = await createProject(n, {
    name: "Saint Mary's Health",
    brands: brandInputs(HOSPITALS),
    questions: questionInputs(),
  });
  const shapes: WaveShape[] = [
    {},
    { lift: { "Saint Mary's Health": 0.7 } },
    { lift: { "Saint Mary's Health": 0.7 }, failing: { gemini: 0.75 } },
  ];
  const source = syntheticSource(HOSPITALS, await familyLookup(n, mary), shapes);
  for (let i = 0; i < shapes.length; i++) {
    const w = await runWave(n, mary, engines, 4, source);
    await countWave(pool, north, w.wave, 1, CURRENT_DETECTOR);
  }
  await publish(n, mary, 1, CURRENT_DETECTOR);
  const first = await draftReport(n, mary, {
    title: "Second wave, for the client",
    pin: { wave: 2, questions: 1, names: 1, detector: CURRENT_DETECTOR },
    note: "Saint Mary's is named more often on both engines. The new benefits pages went live between these two waves.",
  });
  await submitReport(n, first, 1);
  await approveReport(n, first, 2);
  await draftReport(n, mary, {
    title: "Third wave",
    pin: { wave: 3, questions: 1, names: 1, detector: CURRENT_DETECTOR },
    note: "Gemini lost most of its captures. Only the OpenAI half compares.",
  });

  const lake = await createProject(n, {
    name: "Lakeside Medical Center",
    brands: brandInputs([HOSPITALS[2]!, HOSPITALS[0]!, HOSPITALS[1]!]),
    questions: questionInputs(FAMILIES.slice(0, 12), ROLES.slice(0, 2), 3),
  });
  const lakeSource = syntheticSource([HOSPITALS[2]!, HOSPITALS[0]!, HOSPITALS[1]!], await familyLookup(n, lake), [
    {},
    { model: { gemini: "synthetic-gemini-2" } },
  ]);
  for (let i = 0; i < 2; i++)
    await countWave(pool, north, (await runWave(n, lake, engines, 3, lakeSource)).wave, 1, CURRENT_DETECTOR);

  const t = await ctxFor(tide);
  const r = seeded(9);
  const tideProfiles = HOSPITALS.map((p) => ({ ...p, base: { openai: r() * 2 - 1, gemini: r() * 2 - 1 } }));
  const harbor = await createProject(t, {
    name: "Harbor Clinic Group",
    brands: brandInputs([tideProfiles[3]!, tideProfiles[0]!, tideProfiles[4]!]),
    questions: questionInputs(FAMILIES.slice(0, 10), ROLES.slice(0, 2), 2),
  });
  const tideSource = syntheticSource(
    [tideProfiles[3]!, tideProfiles[0]!, tideProfiles[4]!],
    await familyLookup(t, harbor),
    [{}, {}],
  );
  for (let i = 0; i < 2; i++)
    await countWave(pool, tide, (await runWave(t, harbor, engines, 3, tideSource)).wave, 1, CURRENT_DETECTOR);
}
