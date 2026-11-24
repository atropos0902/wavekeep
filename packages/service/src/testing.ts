import { randomBytes } from "node:crypto";
import pg from "pg";
import { makePool } from "./db.ts";
import { migrate } from "./migrate.ts";

/** A fresh database on the server in WAVEKEEP_TEST_PG, or on a container started for the run. */
export async function testDatabase(max = 10) {
  let server = process.env.WAVEKEEP_TEST_PG;
  let stop: (() => Promise<unknown>) | undefined;
  if (!server) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const c = await new PostgreSqlContainer("postgres:18.3").start();
    server = c.getConnectionUri();
    stop = () => c.stop();
  }
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const at = (user?: string): string => {
    const u = new URL(server);
    u.pathname = `/${name}`;
    if (user) {
      u.username = user;
      u.password = "app";
    }
    return u.toString();
  };
  await migrate(at(), "app");
  const pool = makePool(at("wavekeep_app"), max);
  const owner = makePool(at(), 4);
  return {
    pool,
    owner,
    url: at("wavekeep_app"),
    ownerUrl: at(),
    async drop(): Promise<void> {
      await pool.end();
      await owner.end();
      if (stop) await stop();
      else {
        const c = new pg.Client({ connectionString: server });
        await c.connect();
        await c.query(`drop database ${name} with (force)`);
        await c.end();
      }
    },
  };
}
