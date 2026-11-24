import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PgBoss } from "pg-boss";

export const QUEUES = ["capture", "close", "count"] as const;

/** Runs as the owner. The app role never owns a table, so forced RLS always applies to it. */
export async function migrate(
  ownerUrl: string,
  appPassword: string,
  dir = join(import.meta.dirname, "../migrations"),
): Promise<void> {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query("select pg_advisory_lock(72170)");
    const has = await c.query("select 1 from pg_roles where rolname = 'wavekeep_app'");
    if (has.rowCount === 0) await c.query("create role wavekeep_app login");
    await c.query(`alter role wavekeep_app password ${c.escapeLiteral(appPassword)}`);
    await c.query("create table if not exists schema_step (name text primary key)");
    for (const name of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if ((await c.query("select 1 from schema_step where name = $1", [name])).rowCount) continue;
      const sql = readFileSync(join(dir, name), "utf8");
      if (!/^-- step: (expand|contract)$/m.test(sql))
        throw new Error(`${name} doesn't say whether it expands or contracts`);
      await c.query("begin");
      try {
        await c.query(sql);
        await c.query("insert into schema_step values ($1)", [name]);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      }
    }
    const boss = new PgBoss({ connectionString: ownerUrl, supervise: false, schedule: false });
    boss.on("error", () => {});
    await boss.start();
    for (const q of QUEUES) {
      await boss.createQueue(q, {
        policy: "standard",
        retryLimit: 20,
        retryDelay: 1,
        expireInSeconds: 180,
        heartbeatSeconds: 10,
      });
    }
    await boss.stop({ graceful: false });
    await c.query("grant usage on schema pgboss to wavekeep_app");
    await c.query("grant select, insert, update, delete on all tables in schema pgboss to wavekeep_app");
    await c.query("grant execute on all functions in schema pgboss to wavekeep_app");
    await c.query("grant usage on all sequences in schema pgboss to wavekeep_app");
  } finally {
    await c.query("select pg_advisory_unlock(72170)").catch(() => {});
    await c.end();
  }
}
