import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ENGINES, FilterSchema, KINDS, METRICS, type Pin, parsePin } from "@wavekeep/core";
import {
  Conflict,
  type Ctx,
  compare,
  evidence,
  Forbidden,
  fromKey,
  getProject,
  getReport,
  Invalid,
  latestPin,
  listProjects,
  listReports,
  NotFound,
  number,
  OUTCOMES,
  overview,
  questions,
  readablePins,
  sources,
} from "@wavekeep/service";
import type { Context } from "hono";
import type pg from "pg";
import { mcpHandler } from "./mcp.ts";

type Env = { Variables: { ctx: Ctx } };

const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    detail: z.string(),
    code: z.string(),
  })
  .openapi("Problem");

const TITLES: Record<string, [400 | 401 | 403 | 404 | 409 | 429 | 500, string]> = {
  invalid: [400, "Invalid request"],
  unauthenticated: [401, "No valid API key"],
  forbidden: [403, "Not allowed"],
  not_found: [404, "Not found"],
  conflict: [409, "Conflict"],
  rate_limited: [429, "Too many requests"],
  internal: [500, "Something broke"],
};

/** RFC 9457. Clients branch on code, people read detail. */
export function problem(
  c: Context,
  code: keyof typeof TITLES & string,
  detail: string,
  headers: Record<string, string> = {},
): Response {
  const [status, title] = TITLES[code]!;
  return new Response(JSON.stringify({ type: `/problems/${code}`, title, status, detail, code }), {
    status,
    headers: { ...Object.fromEntries(c.res.headers), "content-type": "application/problem+json", ...headers },
  });
}

const list = <T extends string>(of: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : []))
    .pipe(z.array(z.enum(of as readonly [T, ...T[]])))
    .openapi({ type: "string", description: `Comma separated: ${of.join(", ")}` });

const PinText = z
  .string()
  .transform((v, ctx): Pin => {
    const pin = parsePin(v);
    if (pin) return pin;
    ctx.addIssue({ code: "custom", message: "A pin looks like 3.1.1.3: wave, question set, name set, detector." });
    return z.NEVER;
  })
  .openapi({ type: "string", example: "3.1.1.3", description: "wave.questions.names.detector" });

const FilterQuery = {
  kind: z.enum(KINDS).default("core"),
  engines: list(ENGINES),
  families: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : []))
    .pipe(z.array(z.uuid()))
    .openapi({ type: "string", description: "Comma separated family ids" }),
};
const filterOf = (q: { kind: "core" | "explore"; engines: string[]; families: string[] }) =>
  FilterSchema.parse({ kind: q.kind, engines: q.engines, families: q.families });

const params = z.object({ project: z.uuid().openapi({ param: { name: "project", in: "path" } }) });
const Json = z.unknown();
const NumberSchema = z
  .object({
    pin: z.string(),
    brand: z.uuid(),
    metric: z.enum(METRICS),
    planned: z.int(),
    done: z.int(),
    hits: z.int(),
    rate: z.number().nullable(),
    low: z.number().nullable(),
    high: z.number().nullable(),
    asRange: z.boolean(),
  })
  .openapi("Number");
const ProjectSchema = z
  .object({ id: z.uuid(), name: z.string(), names: z.int(), detector: z.int(), questions: z.int() })
  .openapi("Project");

const ok = <S extends z.ZodType>(schema: S, description: string) => ({
  200: { description, content: { "application/json": { schema } } },
  default: { description: "Problem", content: { "application/problem+json": { schema: Problem } } },
});
const route = <P extends string, R extends object, Q extends z.ZodRawShape, O extends z.ZodType>(
  path: P,
  operationId: string,
  summary: string,
  req: R,
  query: z.ZodObject<Q>,
  out: O,
) =>
  createRoute({
    method: "get" as const,
    path,
    operationId,
    summary,
    security: [{ key: [] as string[] }],
    request: { ...req, query },
    responses: ok(out, summary),
  });

export interface ApiOptions {
  now?: () => number;
}

export function makeApi(pool: pg.Pool, o: ApiOptions = {}): OpenAPIHono<Env> {
  const now = o.now ?? Date.now;
  const app = new OpenAPIHono<Env>({
    defaultHook: (r, c) =>
      r.success
        ? undefined
        : problem(c, "invalid", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")),
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "key", { type: "apiKey", in: "header", name: "x-api-key" });

  app.onError((e, c) => {
    if (e instanceof NotFound) return problem(c, "not_found", e.message);
    if (e instanceof Forbidden) return problem(c, "forbidden", e.message);
    if (e instanceof Conflict) return problem(c, "conflict", e.message);
    if (e instanceof Invalid || e instanceof z.ZodError) return problem(c, "invalid", e.message);
    console.error(e);
    return problem(c, "internal", "The request failed. It's logged.");
  });
  app.notFound((c) => problem(c, "not_found", "No such route."));

  const windows = new Map<string, { start: number; used: number }>();
  const guard = async (c: Context<Env>, next: () => Promise<void>): Promise<Response | undefined> => {
    const bearer = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    const key = c.req.header("x-api-key") ?? bearer;
    const who = key ? await fromKey(pool, key) : null;
    if (!who) return problem(c, "unauthenticated", "Send an API key in x-api-key.");
    const t = now();
    let w = windows.get(who.key);
    if (!w || t - w.start >= 60_000) {
      w = { start: t, used: 0 };
      windows.set(who.key, w);
    }
    w.used++;
    const reset = String(Math.ceil((w.start + 60_000 - t) / 1000));
    c.header("X-RateLimit-Limit", String(who.perMinute));
    c.header("X-RateLimit-Remaining", String(Math.max(0, who.perMinute - w.used)));
    c.header("X-RateLimit-Reset", reset);
    if (w.used > who.perMinute)
      return problem(c, "rate_limited", `Try again in ${reset} seconds.`, { "retry-after": reset });
    c.set("ctx", who);
    await next();
    return undefined;
  };
  app.use("/v1/*", guard);
  app.use("/mcp", guard);

  app.get("/healthz", async (c) => {
    await pool.query("select 1");
    return c.json({ ok: true });
  });

  app.openapi(
    route("/v1/projects", "listProjects", "Projects in the workspace", {}, z.object({}), z.array(ProjectSchema)),
    async (c) => c.json(await listProjects(c.get("ctx")), 200),
  );

  app.openapi(
    route(
      "/v1/projects/{project}/pins",
      "listPins",
      "Counted waves under the current versions",
      { params },
      z.object({}),
      z.object({ latest: z.string().nullable(), pins: z.array(z.string()) }),
    ),
    async (c) => {
      const ctx = c.get("ctx");
      const p = await getProject(ctx, c.req.valid("param").project);
      const pins = await readablePins(ctx, p.id, p.names, p.detector);
      const text = pins.map((x) => `${x.wave}.${x.questions}.${x.names}.${x.detector}`);
      return c.json({ latest: text.at(-1) ?? null, pins: text }, 200);
    },
  );

  app.openapi(
    route(
      "/v1/projects/{project}/overview",
      "getOverview",
      "Every brand, every metric, and the change since the previous wave",
      { params },
      z.object({ pin: PinText.optional(), ...FilterQuery }),
      Json,
    ),
    async (c) => {
      const ctx = c.get("ctx");
      const { project } = c.req.valid("param");
      const q = c.req.valid("query");
      const pin = q.pin ?? (await latestPin(ctx, project));
      if (!pin) throw new NotFound("No counted wave yet.");
      return c.json((await overview(ctx, project, pin, filterOf(q))) as object, 200);
    },
  );

  app.openapi(
    route(
      "/v1/projects/{project}/number",
      "getNumber",
      "One number",
      { params },
      z.object({ pin: PinText, brand: z.uuid(), metric: z.enum(METRICS), ...FilterQuery }),
      NumberSchema,
    ),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(
        await number(c.get("ctx"), c.req.valid("param").project, q.pin, q.brand, q.metric, filterOf(q)),
        200,
      );
    },
  );

  app.openapi(
    route(
      "/v1/projects/{project}/evidence",
      "getEvidence",
      "The answers behind a number",
      { params },
      z.object({
        pin: PinText,
        brand: z.uuid(),
        metric: z.enum(METRICS),
        outcome: z.enum(OUTCOMES).default("hit"),
        after: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        ...FilterQuery,
      }),
      Json,
    ),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(
        (await evidence(c.get("ctx"), c.req.valid("param").project, q.pin, { ...q, filter: filterOf(q) })) as object,
        200,
      );
    },
  );

  app.openapi(
    route(
      "/v1/projects/{project}/compare",
      "compareWaves",
      "Two waves, on what both have",
      { params },
      z.object({ from: PinText, to: PinText, brand: z.uuid(), metric: z.enum(METRICS), ...FilterQuery }),
      Json,
    ),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(
        (await compare(
          c.get("ctx"),
          c.req.valid("param").project,
          q.from,
          q.to,
          q.brand,
          q.metric,
          filterOf(q),
        )) as object,
        200,
      );
    },
  );

  app.openapi(
    route(
      "/v1/projects/{project}/sources",
      "getSources",
      "Cited sites and pages",
      { params },
      z.object({ pin: PinText, ...FilterQuery }),
      Json,
    ),
    async (c) => {
      const q = c.req.valid("query");
      return c.json((await sources(c.get("ctx"), c.req.valid("param").project, q.pin, filterOf(q))) as object, 200);
    },
  );

  app.openapi(
    route(
      "/v1/projects/{project}/questions",
      "getQuestions",
      "The question set",
      { params },
      z.object({ version: z.coerce.number().int().positive() }),
      Json,
    ),
    async (c) =>
      c.json(
        (await questions(c.get("ctx"), c.req.valid("param").project, c.req.valid("query").version)) as object,
        200,
      ),
  );

  app.openapi(
    route("/v1/projects/{project}/reports", "listReports", "Reports", { params }, z.object({}), Json),
    async (c) =>
      c.json(
        (await listReports(c.get("ctx"), c.req.valid("param").project)).map(({ payload: _p, ...r }) => r) as object,
        200,
      ),
  );

  app.openapi(
    route(
      "/v1/reports/{report}",
      "getReport",
      "One report",
      { params: z.object({ report: z.uuid() }) },
      z.object({}),
      Json,
    ),
    async (c) => c.json((await getReport(c.get("ctx"), c.req.valid("param").report)) as object, 200),
  );

  app.all("/mcp", mcpHandler);
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Wavekeep API", version: "1", description: "Read-only access to counted waves." },
  });
  return app;
}
