import type { QuestionKind } from "@wavekeep/core";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Ctx, inWorkspace, staffOnly } from "./context.ts";
import { Conflict, Invalid, NotFound, type Tx } from "./db.ts";
import * as s from "./schema.ts";

export interface BrandInput {
  label: string;
  own?: boolean;
  names: { name: string; needsContext?: boolean }[];
  domains: string[];
}
export interface QuestionInput {
  family: string;
  text: string;
  kind: QuestionKind;
}

const orm = (tx: Tx) => drizzle(tx);

export async function createProject(
  ctx: Ctx,
  input: { name: string; brands: BrandInput[]; questions: QuestionInput[] },
): Promise<string> {
  staffOnly(ctx);
  if (input.brands.filter((b) => b.own).length !== 1) throw new Invalid("Exactly one brand must be the project's own.");
  return inWorkspace(ctx, async (tx) => {
    const db = orm(tx);
    const workspaceId = ctx.workspace;
    const [p] = await db.insert(s.project).values({ workspaceId, name: input.name }).returning({ id: s.project.id });
    const projectId = p!.id;
    await db.insert(s.nameSet).values({ workspaceId, projectId, version: 1, note: "First version" });
    for (const b of input.brands) {
      const [row] = await db
        .insert(s.brand)
        .values({ workspaceId, projectId, label: b.label, isOwn: b.own ?? false })
        .returning({ id: s.brand.id });
      const brandId = row!.id;
      await db.insert(s.nameSetName).values(
        b.names.map((n) => ({
          workspaceId,
          projectId,
          version: 1,
          brandId,
          name: n.name,
          needsContext: n.needsContext ?? false,
        })),
      );
      if (b.domains.length)
        await db
          .insert(s.nameSetDomain)
          .values(b.domains.map((domain) => ({ workspaceId, projectId, version: 1, brandId, domain })));
    }
    await db.insert(s.questionSet).values({ workspaceId, projectId, version: 1, note: "First version" });
    await addQuestions(tx, ctx, projectId, 1, input.questions);
    return projectId;
  });
}

async function addQuestions(
  tx: Tx,
  ctx: Ctx,
  projectId: string,
  version: number,
  questions: QuestionInput[],
): Promise<void> {
  const db = orm(tx);
  const workspaceId = ctx.workspace;
  const families = new Map(
    (await db.select().from(s.family).where(eq(s.family.projectId, projectId))).map((f) => [f.label, f.id]),
  );
  for (const q of questions) {
    let familyId = families.get(q.family);
    if (!familyId) {
      const [f] = await db
        .insert(s.family)
        .values({ workspaceId, projectId, label: q.family })
        .returning({ id: s.family.id });
      familyId = f!.id;
      families.set(q.family, familyId);
    }
    const [row] = await db
      .insert(s.question)
      .values({ workspaceId, projectId, familyId, text: q.text })
      .returning({ id: s.question.id });
    await db.insert(s.questionSetItem).values({ workspaceId, projectId, version, questionId: row!.id, kind: q.kind });
  }
}

async function lockProject(tx: Tx, projectId: string) {
  const [p] = await orm(tx).select().from(s.project).where(eq(s.project.id, projectId)).for("update");
  if (!p) throw new NotFound("No such project.");
  return p;
}

export interface QuestionChange {
  add?: QuestionInput[];
  /** A reworded question is a new question. The old one leaves the set and keeps its answers. */
  reword?: { question: string; text: string }[];
  move?: { question: string; kind: QuestionKind }[];
  remove?: string[];
  note: string;
}

/** Any change makes a new version. The caller says which version it started from. */
export async function changeQuestions(
  ctx: Ctx,
  projectId: string,
  from: number,
  change: QuestionChange,
): Promise<number> {
  staffOnly(ctx);
  return inWorkspace(ctx, async (tx) => {
    const db = orm(tx);
    const p = await lockProject(tx, projectId);
    if (p.currentQuestions !== from) throw new Conflict(`The question set is at version ${p.currentQuestions} now.`);
    const items = await db
      .select({
        questionId: s.questionSetItem.questionId,
        kind: s.questionSetItem.kind,
        familyId: s.question.familyId,
        family: s.family.label,
      })
      .from(s.questionSetItem)
      .innerJoin(s.question, eq(s.question.id, s.questionSetItem.questionId))
      .innerJoin(s.family, eq(s.family.id, s.question.familyId))
      .where(and(eq(s.questionSetItem.projectId, projectId), eq(s.questionSetItem.version, from)));
    const known = new Map(items.map((i) => [i.questionId, i]));
    const need = (id: string) => {
      const item = known.get(id);
      if (!item) throw new NotFound("A question in the change isn't in this set.");
      return item;
    };
    const [last] = await db
      .select()
      .from(s.questionSet)
      .where(eq(s.questionSet.projectId, projectId))
      .orderBy(desc(s.questionSet.version))
      .limit(1);
    const version = last!.version + 1;
    const workspaceId = ctx.workspace;
    await db.insert(s.questionSet).values({ workspaceId, projectId, version, note: change.note });
    const gone = new Set([...(change.remove ?? []), ...(change.reword ?? []).map((r) => r.question)]);
    for (const id of gone) need(id);
    const kinds = new Map((change.move ?? []).map((m) => [need(m.question).questionId, m.kind]));
    const keep = items.filter((i) => !gone.has(i.questionId));
    if (keep.length)
      await db.insert(s.questionSetItem).values(
        keep.map((i) => ({
          workspaceId,
          projectId,
          version,
          questionId: i.questionId,
          kind: kinds.get(i.questionId) ?? i.kind,
        })),
      );
    const reworded = (change.reword ?? []).map((r) => ({
      family: need(r.question).family,
      text: r.text,
      kind: need(r.question).kind,
    }));
    await addQuestions(tx, ctx, projectId, version, [...reworded, ...(change.add ?? [])]);
    await db.update(s.project).set({ currentQuestions: version }).where(eq(s.project.id, projectId));
    return version;
  });
}

/** Writes a new name set. Nothing a page shows changes until publish() has counted every closed wave under it. */
export async function addNameSet(
  ctx: Ctx,
  projectId: string,
  brands: { brand: string; names: { name: string; needsContext?: boolean }[]; domains: string[] }[],
  note: string,
): Promise<number> {
  staffOnly(ctx);
  return inWorkspace(ctx, async (tx) => {
    const db = orm(tx);
    await lockProject(tx, projectId);
    const own = new Set(
      (await db.select({ id: s.brand.id }).from(s.brand).where(eq(s.brand.projectId, projectId))).map((b) => b.id),
    );
    const [last] = await db
      .select()
      .from(s.nameSet)
      .where(eq(s.nameSet.projectId, projectId))
      .orderBy(desc(s.nameSet.version))
      .limit(1);
    const version = last!.version + 1;
    const workspaceId = ctx.workspace;
    await db.insert(s.nameSet).values({ workspaceId, projectId, version, note });
    for (const b of brands) {
      if (!own.has(b.brand)) throw new NotFound("No such brand.");
      if (b.names.length)
        await db.insert(s.nameSetName).values(
          b.names.map((n) => ({
            workspaceId,
            projectId,
            version,
            brandId: b.brand,
            name: n.name,
            needsContext: n.needsContext ?? false,
          })),
        );
      if (b.domains.length)
        await db
          .insert(s.nameSetDomain)
          .values(b.domains.map((domain) => ({ workspaceId, projectId, version, brandId: b.brand, domain })));
    }
    return version;
  });
}

export async function readNameSet(ctx: Ctx, projectId: string, version: number) {
  return inWorkspace(ctx, async (tx) => {
    const brands = await tx.query<{
      id: string;
      label: string;
      is_own: boolean;
      names: { name: string; needsContext: boolean }[];
      domains: string[];
    }>(
      `select b.id, b.label, b.is_own,
        coalesce((select json_agg(json_build_object('name', n.name, 'needsContext', n.needs_context) order by n.name) from name_set_name n where n.project_id = b.project_id and n.version = $2 and n.brand_id = b.id), '[]') as names,
        coalesce((select json_agg(d.domain order by d.domain) from name_set_domain d where d.project_id = b.project_id and d.version = $2 and d.brand_id = b.id), '[]') as domains
       from brand b where b.project_id = $1 order by b.is_own desc, b.label`,
      [projectId, version],
    );
    return brands.rows.map((b) => ({ id: b.id, label: b.label, own: b.is_own, names: b.names, domains: b.domains }));
  });
}
