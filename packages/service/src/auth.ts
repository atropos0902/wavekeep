import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { type Ctx, inWorkspace, ownerOnly, type Role } from "./context.ts";
import { withWorkspace } from "./db.ts";

export const sha = (token: string): Buffer => createHash("sha256").update(token).digest();

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
}
const NOBODY = hashPassword(randomBytes(8).toString("hex"));

export async function signIn(pool: pg.Pool, email: string, password: string): Promise<string | null> {
  const r = await pool.query("select * from auth_account($1)", [email]);
  const row = r.rows[0] as { workspace_id: string; account_id: string; password_hash: string } | undefined;
  // The same work either way, so timing doesn't say whether the address exists.
  const ok = passwordMatches(password, row?.password_hash ?? NOBODY);
  if (!row || !ok) return null;
  const token = randomBytes(32).toString("base64url");
  await withWorkspace(pool, row.workspace_id, (tx) =>
    tx.query("insert into session values ($1, $2, $3, now() + interval '12 hours')", [
      sha(token),
      row.workspace_id,
      row.account_id,
    ]),
  );
  return token;
}

export async function fromSession(pool: pg.Pool, token: string): Promise<(Ctx & { name: string }) | null> {
  const r = await pool.query("select * from auth_session($1)", [sha(token)]);
  const s = r.rows[0] as { workspace_id: string; account_id: string; name: string; role: Role } | undefined;
  return s ? { pool, workspace: s.workspace_id, account: s.account_id, role: s.role, name: s.name } : null;
}

export async function signOut(ctx: Ctx, token: string): Promise<void> {
  await inWorkspace(ctx, (tx) => tx.query("delete from session where token_hash = $1", [sha(token)]));
}

export async function fromKey(pool: pg.Pool, key: string): Promise<(Ctx & { key: string; perMinute: number }) | null> {
  const r = await pool.query("select * from auth_key($1)", [sha(key)]);
  const k = r.rows[0] as { workspace_id: string; key_id: string; per_minute: number } | undefined;
  return k
    ? { pool, workspace: k.workspace_id, account: null, role: "analyst", key: k.key_id, perMinute: k.per_minute }
    : null;
}

/** The key is shown once. Only its hash is kept. */
export async function createKey(ctx: Ctx, label: string, perMinute = 600): Promise<string> {
  ownerOnly(ctx);
  const key = `wk_${randomBytes(24).toString("base64url")}`;
  await inWorkspace(ctx, (tx) =>
    tx.query("insert into api_key (workspace_id, label, key_hash, per_minute) values ($1, $2, $3, $4)", [
      ctx.workspace,
      label,
      sha(key),
      perMinute,
    ]),
  );
  return key;
}
