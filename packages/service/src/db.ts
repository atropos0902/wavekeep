import pg from "pg";

pg.types.setTypeParser(pg.types.builtins.INT8, Number);

export type Tx = pg.PoolClient;

export function makePool(url: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max });
  pool.on("error", () => {});
  return pool;
}

/**
 * Every tenant query runs in here. The workspace is set for the transaction only:
 * set on the connection, it would still be there for whoever gets that connection next.
 */
export async function withWorkspace<T>(pool: pg.Pool, workspace: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  let broken: Error | undefined;
  try {
    await tx.query("begin");
    await tx.query("select set_config('app.workspace', $1, true)", [workspace]);
    const out = await fn(tx);
    await tx.query("commit");
    return out;
  } catch (e) {
    await tx.query("rollback").catch((r: Error) => {
      broken = r;
    });
    throw e;
  } finally {
    tx.release(broken);
  }
}

export class NotFound extends Error {
  override name = "NotFound";
}
export class Forbidden extends Error {
  override name = "Forbidden";
}
export class Conflict extends Error {
  override name = "Conflict";
}
export class Invalid extends Error {
  override name = "Invalid";
}
