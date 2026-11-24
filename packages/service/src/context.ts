import type pg from "pg";
import { Forbidden, type Tx, withWorkspace } from "./db.ts";

export type Role = "owner" | "analyst" | "client";

/** Who is asking. Built by auth from a session or an API key, never from request input. */
export interface Ctx {
  pool: pg.Pool;
  workspace: string;
  role: Role;
  account: string | null;
}

export const inWorkspace = <T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withWorkspace(ctx.pool, ctx.workspace, fn);

export function staffOnly(ctx: Ctx): void {
  if (ctx.role === "client") throw new Forbidden("Clients see approved reports only.");
}
export function ownerOnly(ctx: Ctx): void {
  if (ctx.role !== "owner") throw new Forbidden("Only an owner can do this.");
}
