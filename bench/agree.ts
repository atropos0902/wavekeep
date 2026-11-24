// The same number asked of the query layer, the API, the MCP server and the saved answers.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { makeApi } from "@wavekeep/api";
import { ENGINES, METRICS, type Pin, pinKey, seeded } from "@wavekeep/core";
import {
  createKey,
  evidence,
  fromSession,
  listProjects,
  number,
  overview,
  questions,
  readablePins,
  signIn,
} from "@wavekeep/service";
import { seedDemo } from "@wavekeep/service/seed";
import { testDatabase } from "@wavekeep/service/testing";
import { save } from "./save.ts";

const N = Number(process.env.N ?? 10_000);
const db = await testDatabase(12);
await seedDemo(db.owner, db.pool);
const ctx = (await fromSession(db.pool, (await signIn(db.pool, "owner@northlight.example", "demo"))!))!;
const key = await createKey(ctx, "bench", 1e9);
const app = makeApi(db.pool);
const client = new Client({ name: "bench", version: "1" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://local/mcp"), {
    requestInit: { headers: { "x-api-key": key } },
    fetch: async (u, i) => app.request(String(u).replace("http://local", ""), i as RequestInit),
  }) as Parameters<Client["connect"]>[0],
);
const rnd = seeded(404);
const pick = <T>(x: readonly T[]): T => x[Math.floor(rnd() * x.length)]!;
const worlds = await Promise.all(
  (await listProjects(ctx)).map(async (p) => {
    const pins = await readablePins(ctx, p.id, p.names, p.detector);
    const o = await overview(ctx, p.id, pins[0]!, { kind: "core" });
    const q = await questions(ctx, p.id, p.questions);
    return {
      id: p.id,
      pins,
      brands: o.brands.map((b) => b.id),
      families: [...new Set(q.items.map((i) => i.family_id))],
    };
  }),
);
let differ = 0;
let asked = 0;
let empty = 0;
const distinct = new Set<string>();
async function one(): Promise<void> {
  const w = pick(worlds);
  const pin: Pin = pick(w.pins);
  const brand = pick(w.brands);
  const metric = pick(METRICS);
  const kind = rnd() < 0.8 ? ("core" as const) : ("explore" as const);
  const engines = ENGINES.filter(() => rnd() < 0.6);
  const families = rnd() < 0.5 ? w.families.filter(() => rnd() < 0.4) : [];
  const filter = { kind, engines, families };
  distinct.add(JSON.stringify([w.id, pin, brand, metric, filter]));
  const a = await number(ctx, w.id, pin, brand, metric, filter);
  const q = new URLSearchParams({
    pin: pinKey(pin),
    brand,
    metric,
    kind,
    engines: engines.join(","),
    families: families.join(","),
  });
  const b = await (await app.request(`/v1/projects/${w.id}/number?${q}`, { headers: { "x-api-key": key } })).json();
  const c = JSON.parse(
    (
      (await client.callTool({
        name: "get_number",
        arguments: { project: w.id, pin: pinKey(pin), brand, metric, ...filter },
      })) as { content: { text: string }[] }
    ).content[0]!.text,
  );
  const hit = (await evidence(ctx, w.id, pin, { brand, metric, outcome: "hit", filter, countOnly: true })).total;
  const all = (await evidence(ctx, w.id, pin, { brand, metric, outcome: "all", filter, countOnly: true })).total;
  const s = JSON.stringify(a);
  if (JSON.stringify(b) !== s || JSON.stringify(c) !== s || hit !== a.hits || all !== a.done) differ++;
  if (a.done === 0) empty++;
  asked++;
}
let left = N;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (left-- > 0) await one();
  }),
);
save("agree", { asked, "distinct filters": distinct.size, "filters with no answers": empty, differ });
await db.drop();
