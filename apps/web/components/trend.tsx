import type { Filter } from "@wavekeep/core";
import { type Ctx, trend } from "@wavekeep/service/web";
import { scaleLinear, scalePoint } from "d3-scale";
import { dropText, pct, pts, rateText, verdictText } from "@/lib/format";

/** A line is drawn between two waves only when they compare. */
export async function Trend(p: {
  ctx: Ctx;
  project: string;
  names: number;
  detector: number;
  brand: string;
  label: string;
  filter: Filter;
}) {
  const points = await trend(p.ctx, p.project, p.names, p.detector, p.brand, "named", p.filter);
  if (points.length < 2) return null;
  const W = 720;
  const H = 220;
  const x = scalePoint<number>()
    .domain(points.map((q) => q.pin.wave))
    .range([60, W - 40])
    .padding(0.2);
  const tops = points.map((q) => (q.rate.asRange ? (q.rate.bounds?.[1] ?? 0) : (q.rate.interval?.[1] ?? 0)));
  const y = scaleLinear()
    .domain([0, Math.min(1, Math.max(...tops) * 1.1)])
    .nice()
    .range([H - 30, 12]);
  const mid = (q: (typeof points)[number]): number => q.rate.rate ?? 0;
  return (
    <section className="sheet mt-5 p-3" aria-labelledby="trend">
      <h2 id="trend">{p.label}, named, wave by wave</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-labelledby="trend trend-text">
        <title id="trend-text">Rate per wave. The table below has the same values.</title>
        <defs>
          <pattern id="trend-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-own)" strokeWidth="2" />
          </pattern>
        </defs>
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1="52" x2={W - 16} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
            <text x="46" y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--color-soft)">
              {pct(t, 0)}
            </text>
          </g>
        ))}
        {points.map((q, i) => {
          const prev = points[i - 1];
          if (!prev || !q.link?.comparable || q.rate.asRange || prev.rate.asRange || q.link.dropped.length) return null;
          return (
            <line
              key={q.pin.wave}
              x1={x(prev.pin.wave)}
              y1={y(mid(prev))}
              x2={x(q.pin.wave)}
              y2={y(mid(q))}
              stroke="var(--color-own)"
              strokeWidth="2"
            />
          );
        })}
        {points.map((q) => {
          const cx = x(q.pin.wave)!;
          return (
            <g key={q.pin.wave}>
              {q.rate.asRange && q.rate.bounds ? (
                <rect
                  x={cx - 9}
                  width="18"
                  y={y(q.rate.bounds[1])}
                  height={y(q.rate.bounds[0]) - y(q.rate.bounds[1])}
                  fill="url(#trend-hatch)"
                  stroke="var(--color-own)"
                />
              ) : (
                <>
                  {q.rate.interval && (
                    <line
                      x1={cx}
                      x2={cx}
                      y1={y(q.rate.interval[0])}
                      y2={y(q.rate.interval[1])}
                      stroke="var(--color-own)"
                      strokeWidth="4"
                      opacity="0.4"
                      strokeLinecap="round"
                    />
                  )}
                  <circle cx={cx} cy={y(mid(q))} r="5.5" fill="var(--color-own)" />
                </>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-soft)">
                Wave {q.pin.wave}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="overflow-x-auto">
        <table className="cells mt-2 w-full">
          <thead>
            <tr>
              <th scope="col">Wave</th>
              <th scope="col">Rate</th>
              <th scope="col">Against the wave before</th>
              <th scope="col">Left out</th>
            </tr>
          </thead>
          <tbody>
            {points.map((q) => (
              <tr key={q.pin.wave}>
                <th scope="row">Wave {q.pin.wave}</th>
                <td className="num">{rateText(q.rate)}</td>
                <td>
                  {q.link ? (
                    <>
                      {verdictText(q.link)}
                      {q.link.delta !== null && <span className="num text-soft"> {pts(q.link.delta)}</span>}
                    </>
                  ) : (
                    "First wave"
                  )}
                </td>
                <td className="text-soft">{q.link?.dropped.map(dropText).join(". ") || "Nothing"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
