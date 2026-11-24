"use client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ENGINE_LABEL, type Engine, METRIC_LABEL, type Metric } from "@wavekeep/core";
import type { EvidenceAnswer } from "@wavekeep/service/web";
import { parseAsString, useQueryState } from "nuqs";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/** A number that opens the answers behind it. */
export function NumberLink({
  brand,
  metric,
  outcome,
  children,
  label,
}: {
  brand: string;
  metric: Metric;
  outcome: "hit" | "miss" | "all";
  children: ReactNode;
  label: string;
}) {
  const [, set] = useQueryState("evidence", parseAsString.withOptions({ shallow: true, history: "push" }));
  return (
    <button
      type="button"
      className="numlink"
      aria-label={label}
      onClick={() => void set(`${brand}:${metric}:${outcome}`)}
    >
      {children}
    </button>
  );
}

/** Answers are strangers' text. They're shown as text: no HTML, no images, no markdown links. */
function Marked({ answer, brand }: { answer: EvidenceAnswer; brand: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of answer.mentions) {
    if (m.start < at || answer.text.slice(m.start, m.start + m.quote.length) !== m.quote) continue;
    out.push(answer.text.slice(at, m.start));
    out.push(
      <mark key={m.start} className={m.brand === brand ? "own" : "other"}>
        {m.quote}
      </mark>,
    );
    at = m.start + m.quote.length;
  }
  out.push(answer.text.slice(at));
  return <p className="mt-2 max-w-[68ch] break-words whitespace-pre-wrap">{out}</p>;
}

interface Page {
  total: number;
  answers: EvidenceAnswer[];
  next: number | null;
}

export function Evidence({
  project,
  pin,
  filter,
  brands,
  expected,
}: {
  project: string;
  pin: string;
  filter: string;
  brands: { id: string; label: string }[];
  expected: Record<string, number>;
}) {
  const [open, setOpen] = useQueryState("evidence", parseAsString.withOptions({ shallow: true, history: "push" }));
  const [brand, metric, outcome] = (open ?? "").split(":");
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const who = brands.find((b) => b.id === brand);

  const load = useCallback(
    async (after: number) => {
      setState("loading");
      try {
        const res = await fetch(
          `/api/evidence?${filter}&project=${project}&pin=${pin}&brand=${brand}&metric=${metric}&outcome=${outcome}&after=${after}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const page = (await res.json()) as Page;
        setPages((p) => (after === 0 ? [page] : [...p, page]));
        setState("idle");
      } catch {
        setState("failed");
      }
    },
    [brand, metric, outcome, filter, project, pin],
  );
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && who) {
      if (!d.open) d.showModal();
      setPages([]);
      void load(0);
    } else if (d.open) d.close();
  }, [open, who, load]);

  const answers = pages.flatMap((p) => p.answers);
  const last = pages.at(-1);
  const rows = useVirtualizer({
    count: answers.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 220,
    overscan: 4,
    getItemKey: (i) => answers[i]?.id ?? i,
  });
  const total = pages[0]?.total;
  const want = open ? expected[open] : undefined;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="evidence-title"
      onClose={() => void setOpen(null)}
      className="sheet m-0 ml-auto h-dvh max-h-none w-full max-w-2xl p-0 text-ink backdrop:bg-black/40"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-4 border-b border-line p-4">
          <div>
            <h2 id="evidence-title">
              {who?.label}:{" "}
              {outcome === "hit"
                ? METRIC_LABEL[(metric ?? "named") as Metric].toLowerCase()
                : outcome === "miss"
                  ? `not ${METRIC_LABEL[(metric ?? "named") as Metric].toLowerCase()}`
                  : "every completed answer"}
            </h2>
            <p className="text-soft" role="status">
              {total === undefined ? (
                state === "failed" ? (
                  ""
                ) : (
                  "Loading answers"
                )
              ) : (
                <>
                  <span className="num" data-testid="evidence-total">
                    {total}
                  </span>{" "}
                  saved answers, captured through the API
                </>
              )}
            </p>
            {want !== undefined && total !== undefined && want !== total && (
              <p className="text-down">The page says {want}. These don't agree, please report it.</p>
            )}
          </div>
          <button type="button" className="btn ml-auto" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region has to be reachable by keyboard */}
        <section ref={scroller} tabIndex={0} aria-label="Answers" className="min-h-0 flex-1 overflow-y-auto">
          {state === "failed" && answers.length === 0 && (
            <div className="p-4">
              <p>The answers didn't load.</p>
              <button type="button" className="btn mt-2" onClick={() => void load(0)}>
                Try again
              </button>
            </div>
          )}
          {total === 0 && <p className="p-4 text-soft">No answer falls here.</p>}
          <div style={{ height: rows.getTotalSize(), position: "relative" }}>
            {rows.getVirtualItems().map((v) => {
              const a = answers[v.index]!;
              return (
                <article
                  key={v.key}
                  data-index={v.index}
                  ref={rows.measureElement}
                  className="absolute inset-x-0 border-b border-line p-4"
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  <p className="text-soft">
                    {ENGINE_LABEL[a.engine as Engine] ?? a.engine}, {a.family}, repeat{" "}
                    <span className="num">{a.repeat}</span>
                  </p>
                  <h3 className="font-semibold">{a.question}</h3>
                  <Marked answer={a} brand={brand ?? ""} />
                  {a.sources.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {a.sources.map((s) => (
                        <li key={s.url}>
                          <a
                            className="underline"
                            href={/^https?:\/\//.test(s.url) ? s.url : undefined}
                            rel="noopener noreferrer nofollow"
                            target="_blank"
                          >
                            {s.host}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
          {last?.next != null && (
            <div className="p-4">
              <button
                type="button"
                className="btn"
                disabled={state === "loading"}
                onClick={() => void load(last.next!)}
              >
                {state === "loading" ? "Loading" : `Show more (${answers.length} of ${total})`}
              </button>
            </div>
          )}
        </section>
      </div>
    </dialog>
  );
}
