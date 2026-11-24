"use client";
import { parseAsString, useQueryState } from "nuqs";
import { useTransition } from "react";

export function FromWave({ value, pins }: { value: string; pins: string[] }) {
  const [, start] = useTransition();
  const [, set] = useQueryState(
    "from",
    parseAsString.withOptions({ shallow: false, startTransition: start, history: "push" }),
  );
  return (
    <label className="flex items-center gap-2">
      <span className="text-soft">Against</span>
      <select className="field" value={value} onChange={(e) => void set(e.target.value)}>
        {pins.map((p) => (
          <option key={p} value={p}>
            Wave {p.split(".")[0]}
          </option>
        ))}
      </select>
    </label>
  );
}
