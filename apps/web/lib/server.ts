import "server-only";
import { type Filter, FilterSchema, type Metric, type Pin, parsePin, pinKey } from "@wavekeep/core";
import * as service from "@wavekeep/service/web";
import { type Ctx, fromSession, makeBoss, makePool, type Role } from "@wavekeep/service/web";
import { cacheLife } from "next/cache";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

export const COOKIE = "wavekeep";
const g = globalThis as { wkPool?: ReturnType<typeof makePool>; wkBoss?: Promise<ReturnType<typeof makeBoss>> };

export function pool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  g.wkPool ??= makePool(process.env.DATABASE_URL);
  return g.wkPool;
}
export function boss() {
  g.wkBoss ??= (async () => {
    const b = makeBoss(process.env.DATABASE_URL!);
    await b.start();
    return b;
  })();
  return g.wkBoss;
}

export const session = cache(async (): Promise<Ctx & { name: string }> => {
  const token = (await cookies()).get(COOKIE)?.value;
  const ctx = token ? await fromSession(pool(), token) : null;
  if (!ctx) redirect("/sign-in");
  return ctx;
});

export async function project(id: string) {
  const ctx = await session();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const all = await service.listProjects(ctx);
  const found = all.find((p) => p.id === id);
  if (!found) notFound();
  return { ctx, project: found, all };
}

export function pinOf(text: string): Pin {
  const pin = parsePin(text);
  if (!pin) notFound();
  return pin;
}

export type Search = Record<string, string | string[] | undefined>;
export function filterOf(q: Search): Filter {
  const list = (v: string | string[] | undefined) => (typeof v === "string" && v ? v.split(",") : []);
  const r = FilterSchema.safeParse({ kind: q.kind ?? "core", engines: list(q.engines), families: list(q.families) });
  return r.success ? r.data : { kind: "core" };
}

/**
 * Cached reads take the workspace as an argument, so it is part of the cache key and one customer
 * can't be served another's entry. A closed wave under a pin never changes: there is nothing to expire.
 */
const reader = (workspace: string): Ctx => ({ pool: pool(), workspace, role: "analyst", account: null });

async function cachedOverview(
  workspace: string,
  projectId: string,
  pin: string,
  previous: string | null,
  filter: Filter,
) {
  "use cache";
  cacheLife("max");
  // In the key: the wave before this one can be counted after this one was.
  void previous;
  return service.overview(reader(workspace), projectId, parsePin(pin)!, filter);
}
async function cachedCompare(
  workspace: string,
  projectId: string,
  a: string,
  b: string,
  brand: string,
  metric: Metric,
  filter: Filter,
) {
  "use cache";
  cacheLife("max");
  return service.compare(reader(workspace), projectId, parsePin(a)!, parsePin(b)!, brand, metric, filter);
}
async function cachedSources(workspace: string, projectId: string, pin: string, filter: Filter) {
  "use cache";
  cacheLife("max");
  return service.sources(reader(workspace), projectId, parsePin(pin)!, filter);
}

/** Missing numbers are a 404 page, never a stack trace. */
async function known<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if ((e as Error).name === "NotFound" || (e as Error).name === "Invalid") notFound();
    throw e;
  }
}
/** The pin is checked before the cache is asked, so a cached 'not there' can't outlive a new count. */
async function readable(ctx: Ctx, projectId: string, pin: Pin): Promise<string | null> {
  const pins = (await service.readablePins(ctx, projectId, pin.names, pin.detector)).map(pinKey);
  const at = pins.indexOf(pinKey(pin));
  if (at === -1) notFound();
  return pins[at - 1] ?? null;
}

export const read = {
  overview: (ctx: Ctx, p: string, pin: Pin, f: Filter) =>
    known(async () => cachedOverview(ctx.workspace, p, pinKey(pin), await readable(ctx, p, pin), f)),
  compare: (ctx: Ctx, p: string, a: Pin, b: Pin, brand: string, m: Metric, f: Filter) =>
    known(async () => {
      await readable(ctx, p, a);
      await readable(ctx, p, b);
      return cachedCompare(ctx.workspace, p, pinKey(a), pinKey(b), brand, m, f);
    }),
  sources: (ctx: Ctx, p: string, pin: Pin, f: Filter) =>
    known(async () => {
      await readable(ctx, p, pin);
      return cachedSources(ctx.workspace, p, pinKey(pin), f);
    }),
};

export const isStaff = (role: Role): boolean => role !== "client";
