import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type Ctx, createKey, fromSession, listProjects, signIn } from "@wavekeep/service";
import { seedDemo } from "@wavekeep/service/seed";
import { testDatabase } from "@wavekeep/service/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApi } from "./app.ts";

let db: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof makeApi>;
let key = "";
let other = "";
let slow = "";
let mary = "";
let clock = 0;
const get = (path: string, k = key) => app.request(path, { headers: { "x-api-key": k } });
const ctxOf = async (email: string): Promise<Ctx> =>
  (await fromSession(db.pool, (await signIn(db.pool, email, "demo"))!))!;

beforeAll(async () => {
  db = await testDatabase();
  await seedDemo(db.owner, db.pool);
  app = makeApi(db.pool, { now: () => clock });
  const north = await ctxOf("owner@northlight.example");
  key = await createKey(north, "test", 100_000);
  slow = await createKey(north, "slow", 2);
  other = await createKey(await ctxOf("owner@tidewater.example"), "test", 100_000);
  mary = (await listProjects(north)).find((p) => p.name.startsWith("Saint"))!.id;
});
afterAll(() => db?.drop());

describe("api", () => {
  it("answers every failure as a problem document", async () => {
    const cases: [Response, number, string][] = [
      [await app.request("/v1/projects"), 401, "unauthenticated"],
      [await get("/v1/projects", "wk_nope"), 401, "unauthenticated"],
      [await get("/v1/nothing"), 404, "not_found"],
      [await get("/v1/projects/not-a-uuid/pins"), 400, "invalid"],
      [await get(`/v1/projects/${mary}/overview?pin=abc`), 400, "invalid"],
      [await get(`/v1/projects/${mary}/overview?pin=9.1.1.3`), 404, "not_found"],
      [await get(`/v1/projects/${mary}/overview?engines=bing`), 400, "invalid"],
      [await get(`/v1/projects/${mary}/compare?from=1.1.1.3&to=2.1.1.1&brand=${mary}&metric=named`), 400, "invalid"],
    ];
    for (const [res, status, code] of cases) {
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toBe("application/problem+json");
      expect(await res.json()).toMatchObject({
        status,
        code,
        title: expect.any(String),
        detail: expect.any(String),
        type: `/problems/${code}`,
      });
    }
  });
  it("never answers with another workspace's data, on any route in the document", async () => {
    const doc = (await (await app.request("/openapi.json")).json()) as {
      openapi: string;
      paths: Record<string, { get?: { operationId: string } }>;
    };
    expect(doc.openapi).toBe("3.1.0");
    const brand = ((await (await get(`/v1/projects/${mary}/overview`)).json()) as { brands: { id: string }[] })
      .brands[0]!.id;
    const report = ((await (await get(`/v1/projects/${mary}/reports`)).json()) as { id: string }[])[0]!.id;
    const query = `pin=2.1.1.3&from=1.1.1.3&to=2.1.1.3&brand=${brand}&metric=named&version=1`;
    let tried = 0;
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (!ops.get || !path.includes("{")) continue;
      const url = `${path.replace("{project}", mary).replace("{report}", report)}?${query}`;
      expect((await get(url)).status, url).toBe(200);
      const res = await get(url, other);
      const body = await res.text();
      expect(body, url).not.toContain("Saint Mary");
      expect(res.status, url).toBe(404);
      tried++;
    }
    expect(tried).toBe(9);
    expect(await (await get("/v1/projects", other)).text()).not.toContain("Saint Mary");
  });
  it("limits by key and says when to come back", async () => {
    clock = 1_000_000;
    expect((await get("/v1/projects", slow)).headers.get("X-RateLimit-Remaining")).toBe("1");
    expect((await get("/v1/projects", slow)).status).toBe(200);
    const res = await get("/v1/projects", slow);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    clock += 60_000;
    expect((await get("/v1/projects", slow)).status).toBe(200);
  });
});

describe("mcp", () => {
  const connect = async (k: string) => {
    const client = new Client({ name: "t", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL("http://local/mcp"), {
      requestInit: { headers: { "x-api-key": k } },
      fetch: async (u, init) => app.request(String(u).replace("http://local", ""), init as RequestInit),
    });
    await client.connect(transport as Parameters<Client["connect"]>[0]);
    return client;
  };
  const value = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);

  it("needs a key, and every tool is read-only", async () => {
    await expect(connect("wk_no")).rejects.toThrow();
    const c = await connect(key);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "list_projects",
      "get_overview",
      "get_number",
      "get_evidence",
      "compare_waves",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });
  it("gives the number the API gives, and nothing to another workspace", async () => {
    const c = await connect(key);
    const brand = ((await (await get(`/v1/projects/${mary}/overview`)).json()) as { brands: { id: string }[] })
      .brands[0]!.id;
    const args = { project: mary, pin: "3.1.1.3", brand, metric: "named" };
    const api = await (await get(`/v1/projects/${mary}/number?pin=3.1.1.3&brand=${brand}&metric=named`)).json();
    expect(value(await c.callTool({ name: "get_number", arguments: args }))).toEqual(api);
    const o = await connect(other);
    const r = (await o.callTool({ name: "get_number", arguments: args })) as { isError?: boolean };
    expect(r.isError).toBe(true);
  });
});
