import type { Rate } from "@wavekeep/core";

/** A dot with its interval, or a hatched range when too much is missing to print a dot. */
export function RateBar({ rate, own, max = 1 }: { rate: Rate; own: boolean; max?: number }) {
  const w = 180;
  const x = (v: number): number => Math.max(0, Math.min(w, (v / max) * w));
  const color = own ? "var(--color-own)" : "var(--color-rival)";
  return (
    <svg width={w} height="18" viewBox={`0 0 ${w} 18`} aria-hidden="true" className="max-w-full">
      <line x1="0" x2={w} y1="9" y2="9" stroke="var(--color-line)" />
      {rate.asRange && rate.bounds ? (
        <>
          <defs>
            <pattern
              id={own ? "hatch-own" : "hatch"}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="5" stroke={color} strokeWidth="2" />
            </pattern>
          </defs>
          <rect
            x={x(rate.bounds[0])}
            y="4"
            width={Math.max(2, x(rate.bounds[1]) - x(rate.bounds[0]))}
            height="10"
            fill={`url(#${own ? "hatch-own" : "hatch"})`}
            stroke={color}
          />
        </>
      ) : (
        rate.rate !== null && (
          <>
            {rate.interval && (
              <line
                x1={x(rate.interval[0])}
                x2={x(rate.interval[1])}
                y1="9"
                y2="9"
                stroke={color}
                strokeWidth="4"
                opacity="0.4"
                strokeLinecap="round"
              />
            )}
            <circle cx={x(rate.rate)} cy="9" r="5" fill={color} />
          </>
        )
      )}
    </svg>
  );
}
