import { METRIC_LABEL, METRICS } from "@wavekeep/core";
import type { ReportPayload } from "@wavekeep/service/web";
import { dropText, engineName, pts, rateText, verdictText } from "@/lib/format";

export function ReportBody({ payload }: { payload: ReportPayload }) {
  const own = payload.brands.find((b) => b.own);
  return (
    <>
      {payload.note && <p className="mt-2 max-w-[68ch]">{payload.note}</p>}
      <p className="mt-1 text-soft">
        {payload.engines.map((e) => `${engineName(e.engine)}: ${e.done} of ${e.planned} completed`).join(". ")}. Answers
        were captured through the APIs, which isn't the same as what a signed-in person sees.
      </p>
      <div className="overflow-x-auto">
        <table className="cells mt-3 w-full">
          <thead>
            <tr>
              <th scope="col">Employer</th>
              {METRICS.map((m) => (
                <th scope="col" key={m}>
                  {METRIC_LABEL[m]}
                </th>
              ))}
              <th scope="col">{payload.previous ? `Named, since wave ${payload.previous.split(".")[0]}` : "Change"}</th>
            </tr>
          </thead>
          <tbody>
            {payload.brands.map((b) => {
              const c = b.change?.named;
              return (
                <tr key={b.id}>
                  <th scope="row" className={b.own ? "!text-own" : "!text-ink !font-normal"}>
                    {b.label}
                  </th>
                  {METRICS.map((m) => (
                    <td key={m} className="num">
                      {rateText(b.rates[m])}
                    </td>
                  ))}
                  <td>
                    {c ? (
                      <>
                        {verdictText(c)}{" "}
                        {c.delta !== null && c.interval && (
                          <span className="num text-soft">
                            {pts(c.delta)} ({pts(c.interval[0])} to {pts(c.interval[1])})
                          </span>
                        )}
                      </>
                    ) : (
                      "First wave"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {own?.change?.named.dropped.map((d) => (
        <p key={d.engine} className="mt-2 text-warn">
          {dropText(d)}.
        </p>
      ))}
    </>
  );
}
