"use client";
import { startTransition } from "react";
import {
  approveReport,
  draftReport,
  editReport,
  revokeLink,
  type Said,
  shareReport,
  submitReport,
} from "@/lib/actions";
import { useSaid } from "./use-said";

export function DraftReport({ project, pin, wave }: { project: string; pin: string; wave: string }) {
  const [said, act, busy] = useSaid<FormData>(draftReport.bind(null, project, pin));
  return (
    <form action={act} className="sheet mt-4 grid gap-3 p-4">
      <label className="flex max-w-xl flex-col gap-1">
        New report on wave {wave}, title
        <input className="field" name="title" required maxLength={120} />
      </label>
      <label className="flex max-w-xl flex-col gap-1">
        Note for the reader
        <textarea className="field" name="note" rows={2} maxLength={2000} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-main" disabled={busy}>
          Save draft
        </button>
        <p role="status" className={said.error ? "text-down" : "text-soft"}>
          {said.error ?? said.ok}
        </p>
      </div>
    </form>
  );
}

export function ReportActions(p: {
  id: string;
  revision: number;
  status: "draft" | "in_review" | "approved";
  title: string;
  note: string;
  owner: boolean;
  links: { id: string; revoked: boolean }[];
}) {
  const [said, run, busy] = useSaid((_, act: () => Promise<Said>) => act());
  const [edit, act, saving] = useSaid<FormData>(editReport.bind(null, p.id));
  const go = (f: () => Promise<Said>) => () => startTransition(() => run(f));
  return (
    <div className="mt-3 border-t border-line pt-3">
      {p.status !== "approved" && (
        <details>
          <summary className="cursor-pointer text-soft">Edit</summary>
          <form action={act} className="mt-2 grid gap-2">
            <input type="hidden" name="revision" value={p.revision} />
            <label className="flex max-w-xl flex-col gap-1">
              Title
              <input className="field" name="title" defaultValue={p.title} required />
            </label>
            <label className="flex max-w-xl flex-col gap-1">
              Note
              <textarea className="field" name="note" rows={2} defaultValue={p.note} />
            </label>
            <div className="flex items-center gap-3">
              <button type="submit" className="btn" disabled={saving}>
                Save
              </button>
              <p role="status" className={edit.error ? "text-down" : "text-soft"}>
                {edit.error ?? edit.ok}
              </p>
            </div>
          </form>
        </details>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {p.status === "draft" && (
          <button type="button" className="btn" disabled={busy} onClick={go(() => submitReport(p.id, p.revision))}>
            Send for review
          </button>
        )}
        {p.status === "in_review" && p.owner && (
          <button
            type="button"
            className="btn btn-main"
            disabled={busy}
            onClick={go(() => approveReport(p.id, p.revision))}
          >
            Approve
          </button>
        )}
        {p.status === "approved" && (
          <button type="button" className="btn" disabled={busy} onClick={go(() => shareReport(p.id))}>
            Create a share link
          </button>
        )}
        {p.links
          .filter((l) => !l.revoked)
          .map((l, i) => (
            <button key={l.id} type="button" className="btn" disabled={busy} onClick={go(() => revokeLink(l.id))}>
              Revoke link {i + 1}
            </button>
          ))}
        <p role="status" className={said.error ? "text-down" : "text-soft"}>
          {said.error ??
            (said.ok?.startsWith("/r/") ? (
              <>
                Shown once:{" "}
                <a className="num underline" href={said.ok}>
                  {said.ok}
                </a>
              </>
            ) : (
              said.ok
            ))}
        </p>
      </div>
    </div>
  );
}
