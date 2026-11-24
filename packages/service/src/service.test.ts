import type { Pin } from "@wavekeep/core";
import { CURRENT_DETECTOR, detectorV2 } from "@wavekeep/core";
import { ruleJudge } from "@wavekeep/engines";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKey, fromKey, fromSession, signIn, signOut } from "./auth.ts";
import type { Ctx } from "./context.ts";
import { countWave, publish, RULES } from "./count.ts";
import { withWorkspace } from "./db.ts";
import {
  compare,
  evidence,
  forgetEverything,
  latestPin,
  listProjects,
  number,
  overview,
  questions,
  readablePins,
  sources,
  trend,
} from "./read.ts";
import {
  approveReport,
  draftReport,
  editReport,
  getReport,
  listReports,
  openShared,
  revokeLink,
  shareReport,
  submitReport,
  wouldSayNow,
} from "./reports.ts";
import {
  brandInputs,
  familyLookup,
  HOSPITALS,
  makeWorkspace,
  questionInputs,
  runWave,
  seedDemo,
  syntheticSource,
} from "./seed.ts";
import { addNameSet, changeQuestions, createProject, readNameSet } from "./setup.ts";
import { testDatabase } from "./testing.ts";
import { startWave } from "./waves.ts";

let db: Awaited<ReturnType<typeof testDatabase>>;
let north: Ctx;
let tide: Ctx;
let mary: string;
const core = { kind: "core" } as const;

async function ctxOf(email: string): Promise<Ctx> {
  const token = await signIn(db.pool, email, "demo");
  return (await fromSession(db.pool, token!))!;
}
/** A small project of its own, so tests don't disturb each other. */
async function small(families = 6, repeats = 2) {
  const id = await makeWorkspace(db.owner, "Small", []);
  const ctx: Ctx = { pool: db.pool, workspace: id, role: "owner", account: null };
  const project = await createProject(ctx, {
    name: "P",
    brands: brandInputs(HOSPITALS.slice(0, 2)),
    questions: questionInputs(["a", "b", "c", "d", "e", "f", "g", "h"].slice(0, families), ["nurses"], 0),
  });
  return { ctx, project, repeats };
}
beforeAll(async () => {
  db = await testDatabase(12);
  await seedDemo(db.owner, db.pool);
  north = await ctxOf("owner@northlight.example");
  tide = await ctxOf("owner@tidewater.example");
  mary = (await listProjects(north)).find((p) => p.name.startsWith("Saint"))!.id;
});
afterAll(() => db?.drop());

describe("tenancy", () => {
  it("shows each workspace its own projects, and nothing without one", async () => {
    expect((await listProjects(north)).map((p) => p.name)).toEqual(["Lakeside Medical Center", "Saint Mary's Health"]);
    expect((await listProjects(tide)).map((p) => p.name)).toEqual(["Harbor Clinic Group"]);
    expect((await db.pool.query("select * from project")).rowCount).toBe(0);
    expect((await db.pool.query("select * from answer")).rowCount).toBe(0);
  });
  it("a setting left on the connection leaks, which is why withWorkspace sets it in the transaction", async () => {
    const one = new pg.Pool({ connectionString: db.url, max: 1 });
    await one.query("select set_config('app.workspace', $1, false)", [north.workspace]);
    expect((await one.query("select * from project")).rowCount).toBe(2);
    await one.end();
    const two = new pg.Pool({ connectionString: db.url, max: 1 });
    await withWorkspace(two, north.workspace, (tx) => tx.query("select 1"));
    expect((await two.query("select * from project")).rowCount).toBe(0);
    await two.end();
  });
  it("another workspace can't read or write through a known id", async () => {
    const pin = (await latestPin(north, mary))!;
    await expect(overview(tide, mary, pin, core)).rejects.toThrow("haven't been counted");
    await overview(north, mary, pin, core);
    await expect(overview(tide, mary, pin, core)).rejects.toThrow("haven't been counted");
    await expect(startWave(tide, null, mary, { engines: ["openai"], repeats: 1, capMicros: 1 })).rejects.toThrow(
      "No such project",
    );
    await expect(
      withWorkspace(db.pool, tide.workspace, (tx) =>
        tx.query("insert into project (workspace_id, name) values ($1, 'x')", [north.workspace]),
      ),
    ).rejects.toThrow("row-level security");
  });
  it("the app role owns nothing and every tenant table forces row security", async () => {
    const r = await db.owner.query(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' and relname <> 'schema_step' and not (relrowsecurity and relforcerowsecurity)",
    );
    expect(r.rows).toEqual([]);
    const o = await db.owner.query("select 1 from pg_tables where tableowner = 'wavekeep_app'");
    expect(o.rowCount).toBe(0);
  });
});

describe("sign in", () => {
  it("accepts the right password only, and sign out ends it", async () => {
    expect(await signIn(db.pool, "owner@northlight.example", "wrong")).toBeNull();
    expect(await signIn(db.pool, "nobody@northlight.example", "demo")).toBeNull();
    const t = (await signIn(db.pool, "OWNER@northlight.example", "demo"))!;
    const ctx = (await fromSession(db.pool, t))!;
    expect(ctx.role).toBe("owner");
    await signOut(ctx, t);
    expect(await fromSession(db.pool, t)).toBeNull();
  });
  it("keeps only a hash of an API key", async () => {
    const key = await createKey(north, "ci");
    expect((await fromKey(db.pool, key))?.workspace).toBe(north.workspace);
    expect(await fromKey(db.pool, `${key}x`)).toBeNull();
    const r = await db.owner.query("select * from api_key");
    expect(JSON.stringify(r.rows)).not.toContain(key);
    await expect(createKey(await ctxOf("analyst@northlight.example"), "x")).rejects.toThrow("Only an owner");
  });
  it("a client sees approved reports and nothing else", async () => {
    const client = await ctxOf("client@northlight.example");
    expect((await listReports(client, mary)).map((r) => r.status)).toEqual(["approved"]);
    const draft = (await listReports(north, mary)).find((r) => r.status === "draft")!;
    await expect(getReport(client, draft.id)).rejects.toThrow("No such report");
    const pin = (await latestPin(client, mary))!;
    for (const f of [
      () => overview(client, mary, pin, core),
      () => sources(client, mary, pin, core),
      () => questions(client, mary, 1),
      () => startWave(client, null, mary, { engines: ["openai"], repeats: 1, capMicros: 1 }),
      () => draftReport(client, mary, { title: "x", pin, note: "" }),
    ])
      await expect(f()).rejects.toThrow("Clients see");
  });
});

describe("numbers", () => {
  it("tells the story of the third wave: the pooled rate moves and the comparison doesn't", async () => {
    const pins = await readablePins(north, mary, 1, CURRENT_DETECTOR);
    expect(pins.map((p) => p.wave)).toEqual([1, 2, 3]);
    const o3 = await overview(north, mary, pins[2]!, core);
    const own = o3.brands[0]!;
    expect(own.own).toBe(true);
    expect(own.rates.named.asRange).toBe(true);
    expect(own.change!.named.dropped.map((d) => [d.engine, d.reason])).toEqual([["gemini", "incomplete"]]);
    expect(own.change!.named.verdict).toBe("cant_tell");
    const o2 = await overview(north, mary, pins[1]!, core);
    expect(o2.brands[0]!.change!.named.verdict).toBe("up");
    expect(own.rates.named.rate! - o2.brands[0]!.rates.named.rate!).toBeGreaterThan(0.05);
    expect((await overview(north, mary, pins[0]!, core)).previous).toBeNull();
  });
  it("every number equals the answers behind it", async () => {
    for (const pin of await readablePins(north, mary, 1, CURRENT_DETECTOR)) {
      const o = await overview(north, mary, pin, core);
      for (const b of o.brands)
        for (const metric of ["named", "recommended", "cited"] as const) {
          const n = b.rates[metric];
          const ev = (outcome: "hit" | "miss" | "all") =>
            evidence(north, mary, pin, { brand: b.id, metric, outcome, filter: core, countOnly: true });
          expect((await ev("hit")).total).toBe(n.hits);
          expect((await ev("miss")).total).toBe(n.done - n.hits);
          expect((await ev("all")).total).toBe(n.done);
        }
    }
  });
  it("evidence pages through every answer once, with quotes that hold", async () => {
    const pin = (await latestPin(north, mary))!;
    const brand = (await overview(north, mary, pin, core)).brands[0]!;
    const seen = new Set<number>();
    let after = 0;
    for (;;) {
      const page = await evidence(north, mary, pin, {
        brand: brand.id,
        metric: "named",
        outcome: "hit",
        filter: core,
        after,
        limit: 40,
      });
      for (const a of page.answers) {
        expect(a.hit).toBe(true);
        expect(a.mentions.some((m) => m.brand === brand.id)).toBe(true);
        for (const m of a.mentions) expect(a.text.slice(m.start, m.start + m.quote.length)).toBe(m.quote);
        seen.add(a.id);
      }
      if (page.next === null) break;
      after = page.next;
    }
    expect(seen.size).toBe(brand.rates.named.hits);
  });
  it("keeps exploration questions out of the core number", async () => {
    const pin = (await readablePins(north, mary, 1, CURRENT_DETECTOR))[0]!;
    const brand = (await overview(north, mary, pin, core)).brands[0]!;
    expect(brand.rates.named.planned).toBe(800);
    expect((await overview(north, mary, pin, { kind: "explore" })).brands[0]!.rates.named.planned).toBe(80);
    expect(
      (await overview(north, mary, pin, { kind: "core", engines: ["gemini"] })).brands[0]!.rates.named.planned,
    ).toBe(400);
  });
  it("refuses a pin that was never counted", async () => {
    const good = (await latestPin(north, mary))!;
    for (const bad of [
      { ...good, wave: 99 },
      { ...good, names: 9 },
      { ...good, detector: 1 },
      { ...good, questions: 7 },
    ]) {
      await expect(overview(north, mary, bad, core)).rejects.toThrow("haven't been counted");
      await expect(
        evidence(north, mary, bad, { brand: mary, metric: "named", outcome: "all", filter: core }),
      ).rejects.toThrow("haven't been counted");
    }
    const b = (await overview(north, mary, good, core)).brands[0]!.id;
    await expect(compare(north, mary, good, { ...good, detector: 1 }, b, "named", core)).rejects.toThrow(
      "same names and detector",
    );
    await expect(number(north, mary, good, mary, "named", core)).rejects.toThrow("No such brand");
  });
  it("reads sources with the employer's own site split out", async () => {
    const pin = (await readablePins(north, mary, 1, CURRENT_DETECTOR))[0]!;
    const s = await sources(north, mary, pin, core);
    expect(s.answers).toBe(800);
    expect(s.hosts.find((h) => h.host === "careers.saintmarys.example")).toMatchObject({
      own: true,
      owner: "Saint Mary's Health",
    });
    expect(s.hosts.find((h) => h.host === "forum.example")).toMatchObject({ own: false, owner: null });
    expect(s.pages.every((p) => !p.url.includes("utm_"))).toBe(true);
  });
  it("draws a trend with the reason between neighbours", async () => {
    const pin = (await latestPin(north, mary))!;
    const brand = (await overview(north, mary, pin, core)).brands[0]!.id;
    const t = await trend(north, mary, 1, CURRENT_DETECTOR, brand, "named", core);
    expect(t.map((p) => p.link?.verdict ?? null)).toEqual([null, "up", "cant_tell"]);
  });
});

describe("versions", () => {
  it("a new name set changes nothing until every wave is counted, then all of them at once", async () => {
    const { ctx, project } = await small(6);
    const source = syntheticSource(HOSPITALS.slice(0, 2), await familyLookup(ctx, project), []);
    for (let i = 0; i < 2; i++)
      await countWave(
        ctx.pool,
        ctx.workspace,
        (await runWave(ctx, project, ["openai"], 2, source)).wave,
        1,
        CURRENT_DETECTOR,
      );
    const before = (await latestPin(ctx, project))!;
    const o = await overview(ctx, project, before, core);
    const set = await readNameSet(ctx, project, 1);
    const v = await addNameSet(
      ctx,
      project,
      set.map((b) => ({ brand: b.id, names: b.own ? b.names.slice(0, 1) : b.names, domains: b.domains })),
      "Fewer names",
    );
    expect(v).toBe(2);
    expect(await latestPin(ctx, project)).toEqual(before);
    expect(await publish(ctx, project, 2, CURRENT_DETECTOR)).toEqual({ waves: 2 });
    const now = (await latestPin(ctx, project))!;
    expect(now.names).toBe(2);
    forgetEverything();
    expect(await overview(ctx, project, before, core)).toEqual(o);
    expect((await overview(ctx, project, now, core)).brands[0]!.rates.named.hits).toBeLessThanOrEqual(
      o.brands[0]!.rates.named.hits,
    );
    await expect(publish(ctx, project, 9, CURRENT_DETECTOR)).rejects.toThrow("No such name set");
    await expect(publish(ctx, project, 2, 99)).rejects.toThrow("No detector version");
  });
  it("counting twice, or twice at once, gives the same numbers", async () => {
    const { ctx, project } = await small(4);
    const source = syntheticSource(HOSPITALS.slice(0, 2), await familyLookup(ctx, project), []);
    const w = await runWave(ctx, project, ["openai", "gemini"], 2, source);
    await Promise.all([1, 2, 3].map(() => countWave(ctx.pool, ctx.workspace, w.wave, 1, CURRENT_DETECTOR)));
    const pin = (await latestPin(ctx, project))!;
    const o = await overview(ctx, project, pin, core);
    for (const b of o.brands)
      expect(
        (
          await evidence(ctx, project, pin, {
            brand: b.id,
            metric: "named",
            outcome: "hit",
            filter: core,
            countOnly: true,
          })
        ).total,
      ).toBe(b.rates.named.hits);
    const open = await startWave(ctx, null, project, { engines: ["openai"], repeats: 1, capMicros: 10 });
    await expect(countWave(ctx.pool, ctx.workspace, open.wave, 1, CURRENT_DETECTOR)).rejects.toThrow(
      "Only a closed wave",
    );
  });
  it("a reworded question is a new one and drops out of the comparison", async () => {
    const { ctx, project } = await small(8);
    const run = async () => {
      const source = syntheticSource(HOSPITALS.slice(0, 2), await familyLookup(ctx, project), []);
      await countWave(
        ctx.pool,
        ctx.workspace,
        (await runWave(ctx, project, ["openai"], 2, source)).wave,
        1,
        CURRENT_DETECTOR,
      );
    };
    await run();
    const { items } = await questions(ctx, project, 1);
    const v = await changeQuestions(ctx, project, 1, {
      reword: [{ question: items[0]!.id, text: "New words?" }],
      move: [{ question: items[1]!.id, kind: "explore" }],
      note: "One reworded, one moved",
    });
    expect(v).toBe(2);
    await expect(changeQuestions(ctx, project, 1, { remove: [items[2]!.id], note: "" })).rejects.toThrow(
      "version 2 now",
    );
    await expect(changeQuestions(ctx, project, 2, { remove: [items[0]!.id], note: "" })).rejects.toThrow(
      "isn't in this set",
    );
    await run();
    const [a, b] = await readablePins(ctx, project, 1, CURRENT_DETECTOR);
    const brand = (await overview(ctx, project, b!, core)).brands[0]!.id;
    const c = await compare(ctx, project, a!, b!, brand, "named", core);
    expect(c.result).toMatchObject({ questionsMatched: 6, questionsLeftOut: 3 });
  });
});

describe("reports", () => {
  it("goes draft, review, approved, and a stale edit is refused at each step", async () => {
    const pin = (await latestPin(north, mary))!;
    const id = await draftReport(north, mary, { title: "T", pin, note: "n" });
    expect(await editReport(north, id, 1, { title: "T2", note: "n2" })).toBe(2);
    await expect(editReport(north, id, 1, { title: "T3", note: "" })).rejects.toThrow("revision 2 now");
    await expect(approveReport(north, id, 2)).rejects.toThrow();
    expect(await submitReport(north, id, 2)).toBe(3);
    await expect(approveReport(await ctxOf("analyst@northlight.example"), id, 3)).rejects.toThrow("Only an owner");
    await expect(shareReport(north, id)).rejects.toThrow("Only an approved");
    const hash = await approveReport(north, id, 3);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(editReport(north, id, 4, { title: "x", note: "" })).rejects.toThrow("can't change");
    expect((await getReport(north, id)).title).toBe("T2");
  });
  it("a shared link opens the approved bytes, refuses altered ones, and can be revoked", async () => {
    const r = (await listReports(north, mary)).find((x) => x.status === "approved")!;
    const token = await shareReport(north, r.id);
    expect((await openShared(db.pool, token))?.payload).toBe(r.payload);
    expect(await openShared(db.pool, `${token}x`)).toBeNull();
    const fresh = await getReport(north, r.id);
    await db.owner.query("update report set payload = payload || ' ' where id = $1", [r.id]);
    expect(await openShared(db.pool, token)).toBeNull();
    await db.owner.query("update report set payload = $2 where id = $1", [r.id, r.payload]);
    await expect(revokeLink(tide, fresh.links[0]!.id)).rejects.toThrow("No such link");
    for (const l of fresh.links) await revokeLink(north, l.id);
    expect(await openShared(db.pool, token)).toBeNull();
  });
  it("stays as approved and says what it would say now", async () => {
    const r = (await listReports(north, mary)).find((x) => x.title.startsWith("Second"))!;
    expect(await wouldSayNow(north, r.id)).toBeNull();
    const rules = {
      detectors: new Map([
        ...RULES.detectors,
        [4, (t: string, n: Parameters<typeof detectorV2>[1]) => detectorV2(t, n).slice(0, 1)],
      ]),
      judges: new Map([...RULES.judges, [4, ruleJudge]]),
    };
    await publish(north, mary, 1, 4, rules);
    const now = await wouldSayNow(north, r.id);
    expect(now?.pin).toBe("2.1.1.4");
    expect(now!.brands[0]!.rates.named.hits).toBeLessThan(
      (JSON.parse(r.payload!) as typeof now)!.brands[0]!.rates.named.hits,
    );
    expect((await getReport(north, r.id)).payload).toBe(r.payload);
    await publish(north, mary, 1, CURRENT_DETECTOR);
  });
});

it("pins are numbers people can read", async () => {
  const pin: Pin = (await latestPin(north, mary))!;
  expect(pin).toEqual({ wave: 3, questions: 1, names: 1, detector: 3 });
});
