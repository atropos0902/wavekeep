import { makePool, migrate } from "../packages/service/src/index.ts";
import { seedDemo } from "../packages/service/src/seed.ts";

const owner = process.env.OWNER_URL;
const app = process.env.DATABASE_URL;
if (!owner || !app) throw new Error("OWNER_URL and DATABASE_URL are required");
await migrate(owner, new URL(app).password);
const a = makePool(owner, 2);
const b = makePool(app, 10);
await seedDemo(a, b);
await a.end();
await b.end();
console.log("database ready");
