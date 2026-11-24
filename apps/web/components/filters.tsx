"use client";
import { ENGINE_LABEL, type Engine, KINDS, METRIC_LABEL, METRICS } from "@wavekeep/core";
import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { type ReactNode, useTransition } from "react";

export function Filters({
  engines,
  metric = false,
  brands,
  children,
}: {
  engines: string[];
  metric?: boolean;
  brands?: { id: string; label: string }[];
  children?: ReactNode;
}) {
  const [busy, start] = useTransition();
  const [q, set] = useQueryStates(
    {
      kind: parseAsStringLiteral(KINDS).withDefault("core"),
      engines: parseAsArrayOf(parseAsString).withDefault([]),
      metric: parseAsStringLiteral(METRICS).withDefault("named"),
      brand: parseAsString,
    },
    { shallow: false, startTransition: start, history: "push" },
  );
  const toggle = (e: string): void => {
    const now = q.engines.length ? q.engines : engines;
    const next = now.includes(e) ? now.filter((x) => x !== e) : [...now, e];
    void set({ engines: next.length === 0 || next.length === engines.length ? null : next.sort() });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4" aria-busy={busy}>
      <label className="flex items-center gap-2">
        <span className="text-soft">Questions</span>
        <select
          className="field"
          value={q.kind}
          onChange={(e) => void set({ kind: e.target.value === "explore" ? "explore" : null })}
        >
          <option value="core">Core</option>
          <option value="explore">Exploration</option>
        </select>
      </label>
      <fieldset className="flex items-center gap-3">
        <legend className="sr-only">Engines</legend>
        {engines.map((e) => (
          <label key={e} className="flex min-h-9 items-center gap-1.5">
            <input
              type="checkbox"
              checked={q.engines.length === 0 || q.engines.includes(e)}
              onChange={() => toggle(e)}
              className="size-4 accent-[var(--color-own)]"
            />
            {ENGINE_LABEL[e as Engine] ?? e}
          </label>
        ))}
      </fieldset>
      {metric && (
        <label className="flex items-center gap-2">
          <span className="text-soft">Measure</span>
          <select
            className="field"
            value={q.metric}
            onChange={(e) => void set({ metric: e.target.value as (typeof METRICS)[number] })}
          >
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      )}
      {brands && (
        <label className="flex items-center gap-2">
          <span className="text-soft">Employer</span>
          <select
            className="field"
            value={q.brand ?? brands[0]?.id}
            onChange={(e) => void set({ brand: e.target.value })}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {children}
      <span role="status" className="text-soft">
        {busy ? "Updating" : ""}
      </span>
    </div>
  );
}
