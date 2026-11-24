import { METRIC_LABEL, METRICS, type Metric, parsePin, pinKey } from "@wavekeep/core";
import { readablePins } from "@wavekeep/service/web";
import { Filters } from "@/components/filters";
import { FromWave } from "@/components/from-wave";
import { NoPermission, NoWave } from "@/components/no-permission";
import { dropText, engineName, pct, pts, rateText, verdictText } from "@/lib/format";
import { filterOf, isStaff, pinOf, project, read, type Search } from "@/lib/server";

type Props = { params: Promise<{ project: string; pin: string }>; searchParams: Promise<Search> };

async function Body({ params, searchParams }: Props) {
  const { project: id, pin: text } = await params;
  const { ctx, project: p } = await project(id);
  if (!isStaff(ctx.role)) return <NoPermission />;
  if (text === "0.0.0.0") return <NoWave />;
  const pin = pinOf(text);
  const q = await searchParams;
  const filter = filterOf(q);
  const pins = await readablePins(ctx, p.id, pin.names, pin.detector);
  const others = pins.filter((x) => x.wave !== pin.wave);
  const asked = typeof q.from === "string" ? parsePin(q.from) : null;
  const from =
    others.find((x) => asked && pinKey(x) === pinKey(asked)) ??
    others.filter((x) => x.wave < pin.wave).at(-1) ??
    others[0];
  const o = await read.overview(ctx, p.id, pin, { kind: "core" });
  if (!from) return <p className="py-8">There's only one counted wave. A second one makes a comparison possible.</p>;
  const metric: Metric = METRICS.find((m) => m === q.metric) ?? "named";
  const brand = o.brands.find((b) => b.id === q.brand) ?? o.brands[0]!;
  const c = await read.compare(ctx, p.id, from, pin, brand.id, metric, filter);
  const r = c.result;
  const naive =
    c.after.rate.rate !== null && c.before.rate.rate !== null ? c.after.rate.rate - c.before.rate.rate : null;
  const span = Math.max(0.1, ...r.pairs.map((x) => Math.abs(x.after - x.before)));
  const pairs = [...r.pairs].sort((a, b) => b.after - b.before - (a.after - a.before));
  return (
    <>
      <Filters
        engines={o.engines.map((e) => e.engine)}
        metric
        brands={o.brands.map((b) => ({ id: b.id, label: b.label }))}
      >
        <FromWave value={pinKey(from)} pins={others.map(pinKey)} />
      </Filters>
      <section className="sheet p-5">
        <h1>
          {brand.label}, {METRIC_LABEL[metric].toLowerCase()}: wave {from.wave} to wave {pin.wave}
        </h1>
        <p className="mt-3 text-xl">
          <strong className={r.verdict === "up" ? "text-up" : r.verdict === "down" ? "text-down" : ""}>
            {verdictText(r)}
          </strong>
          {r.delta !== null && r.interval && (
            <span className="num ml-3">
              {pts(r.delta)} points ({pts(r.interval[0])} to {pts(r.interval[1])})
            </span>
          )}
        </p>
        {r.comparable && (
          <p className="mt-1 max-w-[68ch] text-soft">
            {r.questionsMatched} questions in {r.pairs.length} families, on {r.engines.map(engineName).join(" and ")}.{" "}
            {r.questionsLeftOut > 0 && `${r.questionsLeftOut} questions are in one wave only and are left out. `}
            {r.p !== null && (
              <>
                Sign-flip test p = <span className="num">{r.p.toFixed(3)}</span>.
              </>
            )}
          </p>
        )}
        {r.dropped.map((d) => (
          <p key={d.engine} className="mt-2 rounded bg-warn-bg px-3 py-2 text-warn">
            {dropText(d)}.
          </p>
        ))}
        {naive !== null && (r.dropped.length > 0 || !r.comparable) && (
          <p className="mt-2 max-w-[68ch] text-soft">
            Subtracting the two pooled rates would say <span className="num">{pts(naive)}</span> points. That mixes a
            different set of answers on each side, so it isn't shown as a change.
          </p>
        )}
        <dl className="mt-4 grid max-w-xl grid-cols-2 gap-4">
          <div>
            <dt className="text-soft">Wave {from.wave}, on its own</dt>
            <dd className="num">{rateText(c.before.rate)}</dd>
          </div>
          <div>
            <dt className="text-soft">Wave {pin.wave}, on its own</dt>
            <dd className="num">{rateText(c.after.rate)}</dd>
          </div>
        </dl>
      </section>
      {r.comparable && (
        <section className="sheet mt-5 overflow-x-auto">
          <h2 className="px-3 pt-3">By question family</h2>
          <table className="cells w-full">
            <thead>
              <tr>
                <th scope="col">Family</th>
                <th scope="col">Wave {from.wave}</th>
                <th scope="col">Wave {pin.wave}</th>
                <th scope="col">Points</th>
                <th scope="col">
                  <span className="sr-only">Difference drawn</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((f) => {
                const d = f.after - f.before;
                const w = (Math.abs(d) / span) * 80;
                return (
                  <tr key={f.family}>
                    <th scope="row" className="!font-normal !text-ink !text-[length:inherit]">
                      {c.families[f.family]}
                    </th>
                    <td className="num">{pct(f.before)}</td>
                    <td className="num">{pct(f.after)}</td>
                    <td className="num">{pts(d)}</td>
                    <td>
                      <svg width="164" height="14" viewBox="0 0 164 14" aria-hidden="true">
                        <line x1="82" x2="82" y1="0" y2="14" stroke="var(--color-soft)" />
                        <rect
                          x={d >= 0 ? 82 : 82 - w}
                          y="3"
                          width={w}
                          height="8"
                          fill={d >= 0 ? "var(--color-up)" : "var(--color-down)"}
                        />
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

export default function Page(props: Props) {
  return <Body {...props} />;
}
