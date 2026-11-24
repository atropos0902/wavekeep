import { METRIC_LABEL, METRICS, pinKey } from "@wavekeep/core";
import type { Overview } from "@wavekeep/service/web";
import Link from "next/link";
import { Evidence, NumberLink } from "@/components/evidence";
import { Filters } from "@/components/filters";
import { NoPermission, NoWave } from "@/components/no-permission";
import { RateBar } from "@/components/rate-bar";
import { Trend } from "@/components/trend";
import { dropText, engineName, pct, pts, rateText, verdictText } from "@/lib/format";
import { filterOf, isStaff, pinOf, project, read, type Search } from "@/lib/server";

type Props = { params: Promise<{ project: string; pin: string }>; searchParams: Promise<Search> };

function Headline({ o, base }: { o: Overview; base: string }) {
  const own = o.brands.find((b) => b.own)!;
  const c = own.change?.named;
  const r = own.rates.named;
  return (
    <section className="sheet grid gap-6 p-5 md:grid-cols-[1fr_auto]">
      <div>
        <h1>
          {own.label} is named in <span className="num !text-[1em]">{rateText(r)}</span> of answers
        </h1>
        {r.asRange && (
          <p className="mt-2 max-w-[62ch] text-warn">
            Too much of this wave is missing for one number. The range runs from every missing answer not naming{" "}
            {own.label} to every one naming it. {pct(r.rate)} of the answers that came back name it.
          </p>
        )}
        {c ? (
          <p className="mt-2 max-w-[62ch]">
            {c.comparable ? (
              <>
                <strong className={c.verdict === "up" ? "text-up" : c.verdict === "down" ? "text-down" : ""}>
                  {verdictText(c)}
                </strong>{" "}
                against wave {o.previous!.wave}
                {c.delta !== null && c.interval && (
                  <>
                    : <span className="num">{pts(c.delta)}</span> points on the {c.questionsMatched} questions both
                    waves have, interval <span className="num">{pts(c.interval[0])}</span> to{" "}
                    <span className="num">{pts(c.interval[1])}</span>
                  </>
                )}
                .
              </>
            ) : (
              <>
                This wave doesn't compare with wave {o.previous!.wave}: {verdictText(c).toLowerCase()}.
              </>
            )}{" "}
            <Link className="underline" href={`${base}/compare`}>
              See the comparison
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-soft">This is the first wave, so there's nothing to compare it with.</p>
        )}
        {c?.dropped.map((d) => (
          <p key={d.engine} className="mt-1 text-warn">
            {dropText(d)}.
          </p>
        ))}
      </div>
      <dl className="grid content-start gap-1">
        {o.engines.map((e) => {
          const share = e.planned ? e.done / e.planned : 0;
          return (
            <div key={e.engine} className="flex items-center justify-between gap-6">
              <dt className="text-soft">{engineName(e.engine)}</dt>
              <dd className={`num ${share < 0.9 ? "text-warn" : ""}`}>
                {e.done} of {e.planned} completed
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

async function Body({ params, searchParams }: Props) {
  const { project: id, pin: text } = await params;
  const { ctx, project: p } = await project(id);
  if (!isStaff(ctx.role)) return <NoPermission />;
  if (text === "0.0.0.0") return <NoWave />;
  const pin = pinOf(text);
  const q = await searchParams;
  const filter = filterOf(q);
  const o = await read.overview(ctx, p.id, pin, filter);
  const engines = (await read.overview(ctx, p.id, pin, { kind: "core" })).engines.map((e) => e.engine);
  const base = `/p/${p.id}/${pinKey(pin)}`;
  const own = o.brands.find((b) => b.own)!;
  const expected = Object.fromEntries(
    o.brands.flatMap((b) =>
      METRICS.flatMap((m) => [
        [`${b.id}:${m}:hit`, b.rates[m].hits],
        [`${b.id}:${m}:miss`, b.rates[m].done - b.rates[m].hits],
        [`${b.id}:${m}:all`, b.rates[m].done],
      ]),
    ),
  );
  const filterQuery = new URLSearchParams({
    kind: filter.kind,
    ...(filter.engines?.length ? { engines: filter.engines.join(",") } : {}),
  }).toString();
  return (
    <>
      <Filters engines={engines} />
      <Headline o={o} base={base} />
      {METRICS.map((m) => {
        const max = Math.min(
          1,
          Math.max(
            0.1,
            ...o.brands.map((b) =>
              b.rates[m].asRange ? (b.rates[m].bounds?.[1] ?? 0) : (b.rates[m].interval?.[1] ?? b.rates[m].rate ?? 0),
            ),
          ) * 1.05,
        );
        return (
          <section key={m} className="sheet mt-5 overflow-x-auto" aria-labelledby={`m-${m}`}>
            <h2 id={`m-${m}`} className="px-3 pt-3">
              {METRIC_LABEL[m]}
            </h2>
            <table className="cells w-full">
              <thead>
                <tr>
                  <th scope="col" className="w-[26%]">
                    Employer
                  </th>
                  <th scope="col" className="w-[22%]">
                    Rate
                  </th>
                  <th scope="col">
                    <span className="sr-only">Interval drawn</span>
                  </th>
                  <th scope="col" className="w-[17%]">
                    Answers
                  </th>
                  <th scope="col" className="w-[22%]">
                    {o.previous ? `Since wave ${o.previous.wave}` : "Change"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.brands.map((b) => {
                  const r = b.rates[m];
                  const c = b.change?.[m];
                  return (
                    <tr key={b.id}>
                      <th
                        scope="row"
                        className={`!text-[length:inherit] ${b.own ? "!text-own" : "!text-ink !font-normal"}`}
                      >
                        {b.label}
                      </th>
                      <td>
                        <span className="num">{rateText(r)}</span>
                        {!r.asRange && r.interval && (
                          <span className="num block text-soft">
                            {pct(r.interval[0])} to {pct(r.interval[1])}
                          </span>
                        )}
                      </td>
                      <td>
                        <RateBar rate={r} own={b.own} max={max} />
                      </td>
                      <td>
                        <NumberLink
                          brand={b.id}
                          metric={m}
                          outcome="hit"
                          label={`${r.hits} answers, ${METRIC_LABEL[m].toLowerCase()}, ${b.label}`}
                        >
                          {r.hits}
                        </NumberLink>
                        <span className="text-soft"> of </span>
                        <NumberLink
                          brand={b.id}
                          metric={m}
                          outcome="all"
                          label={`All ${r.done} completed answers, ${b.label}, ${METRIC_LABEL[m].toLowerCase()}`}
                        >
                          {r.done}
                        </NumberLink>
                        {r.missing > 0 && <span className="num block text-soft">{r.missing} missing</span>}
                      </td>
                      <td>
                        {c ? (
                          <>
                            <span
                              className={
                                c.verdict === "up" ? "text-up" : c.verdict === "down" ? "text-down" : "text-soft"
                              }
                            >
                              {verdictText(c)}
                            </span>
                            {c.delta !== null && c.interval && (
                              <span className="num block text-soft">
                                {pts(c.delta)} ({pts(c.interval[0])} to {pts(c.interval[1])})
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-soft">First wave</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      <Trend
        ctx={ctx}
        project={p.id}
        names={pin.names}
        detector={pin.detector}
        brand={own.id}
        label={own.label}
        filter={filter}
      />
      <Evidence
        project={p.id}
        pin={pinKey(pin)}
        filter={filterQuery}
        brands={o.brands.map((b) => ({ id: b.id, label: b.label }))}
        expected={expected}
      />
    </>
  );
}

export default function Page(props: Props) {
  return <Body {...props} />;
}
