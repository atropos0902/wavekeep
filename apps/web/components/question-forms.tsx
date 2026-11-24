"use client";
import { startTransition } from "react";
import { addQuestion, changeQuestion } from "@/lib/actions";
import { useSaid } from "./use-said";

export function AddQuestion({ project, version, families }: { project: string; version: number; families: string[] }) {
  const [said, act, busy] = useSaid<FormData>(addQuestion.bind(null, project, version));
  return (
    <form action={act} className="sheet mt-4 flex flex-wrap items-end gap-3 p-4">
      <label className="flex min-w-64 flex-1 flex-col gap-1">
        New exploration question
        <input className="field" name="text" required maxLength={400} />
      </label>
      <label className="flex flex-col gap-1">
        Family
        <input className="field" name="family" list="families" required maxLength={80} />
        <datalist id="families">
          {families.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <button type="submit" className="btn btn-main" disabled={busy}>
        Add question
      </button>
      <p role="status" className={`w-full ${said.error ? "text-down" : "text-soft"}`}>
        {said.error ?? said.ok}
      </p>
    </form>
  );
}

export function MoveQuestion({
  project,
  version,
  question,
  text,
  kind,
}: {
  project: string;
  version: number;
  question: string;
  text: string;
  kind: "core" | "explore";
}) {
  const [said, run, busy] = useSaid((_, _none: null) =>
    changeQuestion(project, version, question, kind === "core" ? "explore" : "core"),
  );
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={busy}
        aria-label={`${kind === "core" ? "Move to exploration" : "Move to core"}: ${text}`}
        onClick={() => startTransition(() => run(null))}
      >
        {kind === "core" ? "Move to exploration" : "Move to core"}
      </button>
      {said.error && (
        <p role="alert" className="text-down">
          {said.error}
        </p>
      )}
    </>
  );
}
