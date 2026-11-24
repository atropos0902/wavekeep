import { writeFileSync } from "node:fs";
import { join } from "node:path";
export function save(name: string, value: unknown): void {
  writeFileSync(join(import.meta.dirname, "../results", `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  console.log(name, JSON.stringify(value));
}
