"use client";
import { ENGINE_LABEL, ENGINES } from "@wavekeep/core";
import { useState } from "react";
import { startWave } from "@/lib/actions";
import { useSaid } from "./use-said";

const REPLAY_MICROS = 1000;

export function StartWave({ project, questions }: { project: string; questions: number }) {
  const [said, act, busy] = useSaid<FormData>(startWave.bind(null, project));
  const [engines, setEngines] = useState<string[]>(["openai", "gemini"]);
  const [repeats, setRepeats] = useState(4);
  const captures = questions * repeats * engines.length;
  return (
    <form action={act} className="sheet mt-4 flex flex-wrap items-end gap-4 p-4">
      <fieldset className="flex flex-col gap-1">
        <legend>Engines</legend>
        <span className="flex gap-3">
          {ENGINES.map((e) => (
            <label key={e} className="flex min-h-9 items-center gap-1.5">
              <input
                type="checkbox"
                name="engines"
                value={e}
                checked={engines.includes(e)}
                onChange={() => setEngines(engines.includes(e) ? engines.filter((x) => x !== e) : [...engines, e])}
                className="size-4 accent-[var(--color-own)]"
              />
              {ENGINE_LABEL[e]}
            </label>
          ))}
        </span>
      </fieldset>
      <label className="flex flex-col gap-1">
        Repeats
        <input
          className="field num w-20"
          name="repeats"
          type="number"
          min={1}
          max={20}
          value={repeats}
          onChange={(e) => setRepeats(Number(e.target.value))}
        />
      </label>
      <label className="flex flex-col gap-1">
        Spending cap, dollars
        <input className="field num w-28" name="cap" type="number" min="0.01" step="0.01" defaultValue="5.00" />
      </label>
      <button type="submit" className="btn btn-main" disabled={busy || captures === 0}>
        Start wave
      </button>
      <p className="w-full text-soft">
        <span className="num">{captures}</span> captures, about{" "}
        <span className="num">${((captures * REPLAY_MICROS) / 1e6).toFixed(2)}</span> with the replay engines. The wave
        stops asking when it reaches the cap.
      </p>
      <p role="status" className={`w-full ${said.error ? "text-down" : ""}`}>
        {said.error ?? said.ok}
      </p>
    </form>
  );
}
