import { METRICS, type Metric, parsePin } from "@wavekeep/core";
import { evidence, fromSession, OUTCOMES, type Outcome } from "@wavekeep/service/web";
import { cookies } from "next/headers";
import { COOKIE, filterOf, pool } from "@/lib/server";

export async function GET(req: Request): Promise<Response> {
  const token = (await cookies()).get(COOKIE)?.value;
  const ctx = token ? await fromSession(pool(), token) : null;
  if (!ctx) return Response.json({ error: "sign in" }, { status: 401 });
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const pin = parsePin(q.pin ?? "");
  const uuid = /^[0-9a-f-]{36}$/;
  if (
    !pin ||
    !uuid.test(q.project ?? "") ||
    !uuid.test(q.brand ?? "") ||
    !METRICS.includes(q.metric as Metric) ||
    !OUTCOMES.includes(q.outcome as Outcome)
  )
    return Response.json({ error: "invalid" }, { status: 400 });
  try {
    return Response.json(
      await evidence(ctx, q.project!, pin, {
        brand: q.brand!,
        metric: q.metric as Metric,
        outcome: q.outcome as Outcome,
        filter: filterOf(q),
        after: Number(q.after) || 0,
        limit: 25,
      }),
      {
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (e) {
    const name = (e as Error).name;
    return Response.json({ error: name }, { status: name === "NotFound" ? 404 : name === "Forbidden" ? 403 : 500 });
  }
}
