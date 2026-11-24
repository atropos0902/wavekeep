import { createHash, randomBytes } from "node:crypto";
import { type Pin, parsePin, pinKey } from "@wavekeep/core";
import type pg from "pg";
import { sha } from "./auth.ts";
import { type Ctx, inWorkspace, staffOnly } from "./context.ts";
import { Conflict, Forbidden, Invalid, NotFound } from "./db.ts";
import { getProject, type Overview, overview, readablePins } from "./read.ts";

export interface ReportPayload {
  project: string;
  pin: string;
  previous: string | null;
  engines: Overview["engines"];
  brands: Overview["brands"];
  note: string;
}

async function build(ctx: Ctx, projectId: string, pin: Pin, note: string): Promise<ReportPayload> {
  const p = await getProject(ctx, projectId);
  const o = await overview(ctx, projectId, pin, { kind: "core" });
  return {
    project: p.name,
    pin: pinKey(pin),
    previous: o.previous && pinKey(o.previous),
    engines: o.engines,
    brands: o.brands,
    note,
  };
}

export interface ReportRow {
  id: string;
  project_id: string;
  title: string;
  status: "draft" | "in_review" | "approved";
  revision: number;
  pin: string;
  note: string;
  payload: string | null;
  payload_sha256: string | null;
  links: { id: string; revoked: boolean }[];
}

const COLUMNS = `r.id, r.project_id, r.title, r.status, r.revision, r.pin, r.note, r.payload, r.payload_sha256,
  coalesce((select json_agg(json_build_object('id', l.id, 'revoked', l.revoked) order by l.id) from share_link l where l.report_id = r.id), '[]') as links`;

export async function listReports(ctx: Ctx, project: string): Promise<ReportRow[]> {
  await getProject(ctx, project);
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<ReportRow>(
      `select ${COLUMNS} from report r where r.project_id = $1 and ($2 or r.status = 'approved') order by r.title, r.id`,
      [project, ctx.role !== "client"],
    );
    return r.rows;
  });
}

export async function getReport(ctx: Ctx, id: string): Promise<ReportRow> {
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<ReportRow>(
      `select ${COLUMNS} from report r where r.id = $1 and ($2 or r.status = 'approved')`,
      [id, ctx.role !== "client"],
    );
    if (!r.rows[0]) throw new NotFound("No such report.");
    return r.rows[0];
  });
}

export async function draftReport(
  ctx: Ctx,
  project: string,
  input: { title: string; pin: Pin; note: string },
): Promise<string> {
  staffOnly(ctx);
  if (!input.title.trim()) throw new Invalid("A report needs a title.");
  await overview(ctx, project, input.pin, { kind: "core" });
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<{ id: string }>(
      "insert into report (workspace_id, project_id, title, pin, note) values ($1, $2, $3, $4, $5) returning id",
      [ctx.workspace, project, input.title.trim(), pinKey(input.pin), input.note],
    );
    return r.rows[0]!.id;
  });
}

/** Two people editing: the second one is told, and nothing of theirs is written. */
export async function editReport(
  ctx: Ctx,
  id: string,
  revision: number,
  input: { title: string; note: string },
): Promise<number> {
  staffOnly(ctx);
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<{ revision: number }>(
      "update report set title = $3, note = $4, status = 'draft', revision = revision + 1 where id = $1 and revision = $2 and status <> 'approved' returning revision",
      [id, revision, input.title, input.note],
    );
    if (!r.rows[0]) return stale(tx, id);
    return r.rows[0].revision;
  });
}

async function stale(tx: pg.PoolClient, id: string): Promise<never> {
  const r = await tx.query<{ status: string; revision: number }>("select status, revision from report where id = $1", [
    id,
  ]);
  if (!r.rows[0]) throw new NotFound("No such report.");
  if (r.rows[0].status === "approved") throw new Conflict("This report is approved and can't change.");
  throw new Conflict(`Someone else changed this report. It's at revision ${r.rows[0].revision} now.`);
}

export async function submitReport(ctx: Ctx, id: string, revision: number): Promise<number> {
  staffOnly(ctx);
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query<{ revision: number }>(
      "update report set status = 'in_review', revision = revision + 1 where id = $1 and revision = $2 and status = 'draft' returning revision",
      [id, revision],
    );
    if (!r.rows[0]) return stale(tx, id);
    return r.rows[0].revision;
  });
}

/** Approving stores the exact bytes a client will see, with their hash. */
export async function approveReport(ctx: Ctx, id: string, revision: number): Promise<string> {
  if (ctx.role !== "owner") throw new Forbidden("Only an owner approves a report.");
  const draft = await getReport(ctx, id);
  const pin = parsePin(draft.pin);
  if (!pin) throw new Invalid("The report has no readable pin.");
  const payload = JSON.stringify(await build(ctx, draft.project_id, pin, draft.note));
  const hash = createHash("sha256").update(payload).digest("hex");
  return inWorkspace(ctx, async (tx) => {
    const r = await tx.query(
      "update report set status = 'approved', payload = $3, payload_sha256 = $4, approved_by = $5, revision = revision + 1 where id = $1 and revision = $2 and status = 'in_review' returning id",
      [id, revision, payload, hash, ctx.account],
    );
    if (r.rowCount === 0) return stale(tx, id);
    return hash;
  });
}

/** What an approved report would say under today's names and detector. The report itself stays as it is. */
export async function wouldSayNow(ctx: Ctx, id: string): Promise<ReportPayload | null> {
  staffOnly(ctx);
  const r = await getReport(ctx, id);
  const pin = parsePin(r.pin)!;
  const p = await getProject(ctx, r.project_id);
  if (pin.names === p.names && pin.detector === p.detector) return null;
  const now = (await readablePins(ctx, r.project_id, p.names, p.detector)).find((x) => x.wave === pin.wave);
  return now ? build(ctx, r.project_id, now, r.note) : null;
}

export async function shareReport(ctx: Ctx, id: string): Promise<string> {
  staffOnly(ctx);
  const r = await getReport(ctx, id);
  if (r.status !== "approved") throw new Invalid("Only an approved report is shared.");
  const token = randomBytes(24).toString("base64url");
  await inWorkspace(ctx, (tx) =>
    tx.query("insert into share_link (workspace_id, report_id, token_hash) values ($1, $2, $3)", [
      ctx.workspace,
      id,
      sha(token),
    ]),
  );
  return token;
}

export async function revokeLink(ctx: Ctx, link: string): Promise<void> {
  staffOnly(ctx);
  const r = await inWorkspace(ctx, (tx) => tx.query("update share_link set revoked = true where id = $1", [link]));
  if (r.rowCount === 0) throw new NotFound("No such link.");
}

/** The public page. It reads stored bytes and refuses them if they no longer match their hash. */
export async function openShared(pool: pg.Pool, token: string): Promise<{ title: string; payload: string } | null> {
  const r = await pool.query<{ title: string; payload: string; payload_sha256: string }>(
    "select * from shared_report($1)",
    [sha(token)],
  );
  const row = r.rows[0];
  if (!row || createHash("sha256").update(row.payload).digest("hex") !== row.payload_sha256) return null;
  return { title: row.title, payload: row.payload };
}
