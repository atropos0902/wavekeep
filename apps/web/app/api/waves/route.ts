import { fromSession, listWaves } from "@wavekeep/service/web";
import { cookies } from "next/headers";
import { COOKIE, isStaff, pool } from "@/lib/server";

export async function GET(req: Request): Promise<Response> {
  const token = (await cookies()).get(COOKIE)?.value;
  const ctx = token ? await fromSession(pool(), token) : null;
  if (!ctx) return Response.json(null, { status: 401 });
  if (!isStaff(ctx.role)) return Response.json(null, { status: 403 });
  const id = new URL(req.url).searchParams.get("project") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json(null, { status: 400 });
  const w = (await listWaves(ctx, id)).at(-1);
  return Response.json(
    w ? { seq: w.seq, status: w.status, counted: w.counted, planned: w.planned, done: w.done, failed: w.failed } : null,
    { headers: { "cache-control": "private, no-store" } },
  );
}
