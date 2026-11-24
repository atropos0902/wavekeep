// A million saved answers, then 50 people on the overview.
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { CURRENT_DETECTOR } from "@wavekeep/core";
import type { Ctx } from "@wavekeep/service";
import { countWave, createKey, createProject, makePool, migrate, readablePins } from "@wavekeep/service";
import { brandInputs, HOSPITALS, makeWorkspace } from "@wavekeep/service/seed";
import { save } from "./save.ts";

const ownerUrl = process.env.LOAD_PG!;
const appUrl = ownerUrl.replace("postgres:x@", "wavekeep_app:app@");
await migrate(ownerUrl, "app");
const owner = makePool(ownerUrl, 2);
const pool = makePool(appUrl, 8);
const WAVES = Number(process.env.WAVES ?? 25);
const QUESTIONS = 1000;
const REPEATS = 20;
let ws = (await owner.query<{ id: string }>("select id from workspace where name = 'load'")).rows[0]?.id;
let project: string;
const ctxOf = (id: string): Ctx => ({ pool, workspace: id, role: "owner", account: null });
if (!ws) {
  ws = await makeWorkspace(owner, "load", []);
  const questions = Array.from({ length: QUESTIONS }, (_, i) => ({
    family: `Family ${i % 100}`,
    text: `Question ${i}?`,
    kind: "core" as const,
  }));
  project = await createProject(ctxOf(ws), { name: "Load", brands: brandInputs(HOSPITALS), questions });
  for (let w = 1; w <= WAVES; w++) {
    const wave = (
      await owner.query<{ id: string }>(
        "insert into wave (workspace_id, project_id, seq, questions_version, repeats, cap_micros) values ($1, $2, $3, 1, $4, 1000000000) returning id",
        [ws, project, w, REPEATS],
      )
    ).rows[0]!.id;
    await owner.query("insert into wave_spend (wave_id, workspace_id) values ($1, $2)", [wave, ws]);
    await owner.query(
      "insert into capture (workspace_id, wave_id, question_id, engine, repeat, status) select $1, $2, q.id, e, r, 'done' from question q, unnest(array['openai', 'gemini']) e, generate_series(1, $4::int) r where q.project_id = $3",
      [ws, wave, project, REPEATS],
    );
    await owner.query(
      "insert into wave_engine (wave_id, workspace_id, engine, planned) select $1, $2, engine, count(*) from capture where wave_id = $1 group by engine",
      [wave, ws],
    );
    await owner.query(
      `insert into answer (capture_id, workspace_id, wave_id, question_id, engine, text, model, cost_micros)
       select c.id, c.workspace_id, c.wave_id, c.question_id, c.engine, 'Pay bands differ by site, so ask for the range in writing.' ||
         case when random() < 0.4 then E'\n- Working at Saint Mary''s Health is mentioned in several threads.' else '' end ||
         case when random() < 0.5 then E'\n- Summit has several open roles in this area.' else '' end ||
         case when random() < 0.3 then E'\n- A strong choice is Lakeside Medical Center for parents.' else '' end ||
         case when random() < 0.2 then E'\n- Nurses at Harbor Clinic Group report mixed experiences.' else '' end, 'm1', 900
       from capture c where c.wave_id = $1`,
      [wave],
    );
    await owner.query(
      "insert into wave_cell select wave_id, workspace_id, question_id, engine, count(*), count(*) from capture where wave_id = $1 group by 1, 2, 3, 4",
      [wave],
    );
    await owner.query("update wave_engine set done = planned, failed = 0, model = 'm1' where wave_id = $1", [wave]);
    await owner.query("update wave set status = 'closed', planned = $2, done = $2, failed = 0 where id = $1", [
      wave,
      QUESTIONS * REPEATS * 2,
    ]);
    const t = performance.now();
    await countWave(pool, ws, wave, 1, CURRENT_DETECTOR);
    if (w === 1 || w === WAVES) console.log(`wave ${w} counted in ${Math.round(performance.now() - t)} ms`);
  }
  await owner.query("vacuum analyze");
}
project = (await owner.query<{ id: string }>("select id from project where workspace_id = $1", [ws])).rows[0]!.id;
const ctx = ctxOf(ws);
const answers = (await owner.query<{ n: number }>("select count(*) as n from answer")).rows[0]!.n;
const key = await createKey(ctx, "load", 1_000_000_000);
const pins = (await readablePins(ctx, project, 1, CURRENT_DETECTOR)).map(
  (p) => `${p.wave}.${p.questions}.${p.names}.${p.detector}`,
);
const start = async (): Promise<ChildProcess> => {
  const p = spawn(process.execPath, [join(import.meta.dirname, "../apps/api/src/server.ts")], {
    env: { ...process.env, DATABASE_URL: appUrl, PORT: "4399" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (;;) {
    try {
      if ((await fetch("http://127.0.0.1:4399/healthz")).ok) return p;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
};
const variants = ["", "&engines=openai", "&engines=gemini"];
const ask = async (pin: string, v: string): Promise<number> => {
  const t = performance.now();
  const res = await fetch(`http://127.0.0.1:4399/v1/projects/${project}/overview?pin=${pin}${v}`, {
    headers: { "x-api-key": key },
  });
  const body = await res.text();
  if (res.status !== 200 || body.length < 1000) throw new Error(`${res.status} ${body.slice(0, 200)}`);
  return performance.now() - t;
};
const at = (xs: number[], q: number): number =>
  Math.round(xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!);

let server = await start();
const cold: number[] = [];
for (const pin of pins) for (const v of variants) cold.push(await ask(pin, v));
server.kill("SIGKILL");

async function users(thinkMs: number, seconds: number) {
  server = await start();
  const all: number[] = [];
  const until = performance.now() + seconds * 1000;
  await Promise.all(
    Array.from({ length: 50 }, async () => {
      await new Promise((r) => setTimeout(r, Math.random() * thinkMs));
      while (performance.now() < until) {
        all.push(await ask(pins[Math.floor(Math.random() * pins.length)]!, variants[Math.floor(Math.random() * 3)]!));
        if (thinkMs) await new Promise((r) => setTimeout(r, thinkMs * (0.5 + Math.random())));
      }
    }),
  );
  server.kill("SIGKILL");
  return { requests: all.length, p50: at(all, 0.5), p95: at(all, 0.95), p99: at(all, 0.99) };
}
save("load", {
  answers,
  "first request for a pin, one at a time": { requests: cold.length, p50: at(cold, 0.5), p95: at(cold, 0.95) },
  "50 users, a request every second each, cold start": await users(1000, 45),
  "50 users, no pause between requests, cold start": await users(0, 30),
});
await owner.end();
await pool.end();
