// An approved report against 50 later changes of names and detector.
import { createHash } from "node:crypto";
import { detectorV2, seeded } from "@wavekeep/core";
import { ruleJudge } from "@wavekeep/engines";
import {
  addNameSet,
  forgetEverything,
  fromSession,
  getReport,
  latestPin,
  listProjects,
  listReports,
  openShared,
  overview,
  publish,
  RULES,
  readNameSet,
  shareReport,
  signIn,
} from "@wavekeep/service";
import { seedDemo } from "@wavekeep/service/seed";
import { testDatabase } from "@wavekeep/service/testing";
import { save } from "./save.ts";

const db = await testDatabase();
await seedDemo(db.owner, db.pool);
const ctx = (await fromSession(db.pool, (await signIn(db.pool, "owner@northlight.example", "demo"))!))!;
const project = (await listProjects(ctx)).find((p) => p.name.startsWith("Saint"))!.id;
const report = (await listReports(ctx, project)).find((r) => r.status === "approved")!;
const token = await shareReport(ctx, report.id);
const hash = createHash("sha256").update(report.payload!).digest("hex");
const oldPin = (await latestPin(ctx, project))!;
const oldPage = JSON.stringify(await overview(ctx, project, oldPin, { kind: "core" }));
const rnd = seeded(77);
let same = 0;
let oldPages = 0;
const moved = new Set<string>();
for (let i = 1; i <= 50; i++) {
  if (i % 2) {
    const set = await readNameSet(ctx, project, 1);
    const v = await addNameSet(
      ctx,
      project,
      set.map((b) => ({ brand: b.id, names: b.names.filter(() => rnd() < 0.8), domains: b.domains })),
      `change ${i}`,
    );
    await publish(ctx, project, v, 3);
  } else {
    const version = 100 + i;
    const cut = rnd();
    const rules = {
      detectors: new Map([
        ...RULES.detectors,
        [
          version,
          (t: string, n: Parameters<typeof detectorV2>[1]) =>
            detectorV2(t, n).filter((_, k) => (k * 0.37 + cut) % 1 > 0.2),
        ],
      ]),
      judges: new Map([...RULES.judges, [version, ruleJudge]]),
    };
    const now = (await listProjects(ctx)).find((p) => p.id === project)!;
    await publish(ctx, project, now.names, version, rules);
  }
  forgetEverything();
  const r = await getReport(ctx, report.id);
  const shared = await openShared(db.pool, token);
  if (createHash("sha256").update(r.payload!).digest("hex") === hash && shared?.payload === report.payload) same++;
  if (JSON.stringify(await overview(ctx, project, oldPin, { kind: "core" })) === oldPage) oldPages++;
  moved.add(
    JSON.stringify(
      (await overview(ctx, project, (await latestPin(ctx, project))!, { kind: "core" })).brands[0]!.rates.named.hits,
    ),
  );
}
save("frozen", {
  changes: 50,
  "report bytes identical": same,
  "old pin page identical": oldPages,
  "distinct current numbers seen meanwhile": moved.size,
});
await db.drop();
