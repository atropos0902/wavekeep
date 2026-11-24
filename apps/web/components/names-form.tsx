"use client";
import { saveNames } from "@/lib/actions";
import { useSaid } from "./use-said";

export function NamesForm({
  project,
  version,
  brands,
}: {
  project: string;
  version: number;
  brands: {
    id: string;
    label: string;
    own: boolean;
    names: { name: string; needsContext: boolean }[];
    domains: string[];
  }[];
}) {
  const [said, act, busy] = useSaid<FormData>(saveNames.bind(null, project, version));
  return (
    <form action={act} className="mt-4 grid gap-4">
      {brands.map((b) => (
        <fieldset key={b.id} className="sheet grid gap-3 p-4 sm:grid-cols-2">
          <legend className={`px-1 font-semibold ${b.own ? "text-own" : ""}`}>{b.label}</legend>
          <label className="flex flex-col gap-1">
            Names, one per line
            <textarea
              className="field"
              rows={3}
              name={`names:${b.id}`}
              defaultValue={b.names.map((n) => n.name + (n.needsContext ? "?" : "")).join("\n")}
            />
          </label>
          <label className="flex flex-col gap-1">
            Own sites, one per line
            <textarea className="field" rows={3} name={`domains:${b.id}`} defaultValue={b.domains.join("\n")} />
          </label>
        </fieldset>
      ))}
      <label className="flex max-w-xl flex-col gap-1">
        What changed
        <input className="field" name="note" required maxLength={200} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-main" disabled={busy}>
          {busy ? "Counting every wave" : "Save and count again"}
        </button>
        <p role="status" className={said.error ? "text-down" : "text-soft"}>
          {said.error ?? said.ok}
        </p>
      </div>
    </form>
  );
}
