import { listWaves, questions } from "@wavekeep/service/web";
import { NoPermission } from "@/components/no-permission";
import { StartWave } from "@/components/start-wave";
import { WaveProgress } from "@/components/wave-progress";
import { dollars, engineName } from "@/lib/format";
import { isStaff, project } from "@/lib/server";

type Props = { params: Promise<{ project: string }> };

async function Body({ params }: Props) {
  const { ctx, project: p } = await project((await params).project);
  if (!isStaff(ctx.role)) return <NoPermission />;
  const waves = await listWaves(ctx, p.id);
  const { items } = await questions(ctx, p.id, p.questions);
  const open = waves.find((w) => w.status === "open");
  const counting = waves.some((w) => w.status === "closed" && !w.counted);
  return (
    <section className="py-5">
      <h1>Waves</h1>
      <p className="mt-1 max-w-[68ch] text-soft">
        A wave asks every question on every engine. It closes when each capture has an answer or a final failure, and
        after that its answers can't change.
      </p>
      {open || counting ? <WaveProgress project={p.id} /> : <StartWave project={p.id} questions={items.length} />}
      <div className="sheet mt-5 overflow-x-auto">
        <table className="cells w-full">
          <thead>
            <tr>
              <th scope="col">Wave</th>
              <th scope="col">State</th>
              <th scope="col">Questions</th>
              <th scope="col">Completed</th>
              <th scope="col">By engine</th>
              <th scope="col">Spent</th>
            </tr>
          </thead>
          <tbody>
            {waves.toReversed().map((w) => (
              <tr key={w.id}>
                <th scope="row">Wave {w.seq}</th>
                <td>{w.status === "open" ? "Running" : w.counted ? "Closed and counted" : "Closed, being counted"}</td>
                <td className="num">
                  v{w.questions_version}, {w.repeats} repeats
                </td>
                <td className="num">
                  {w.done} of {w.planned}
                </td>
                <td>
                  {w.engines.map((e) => (
                    <span
                      key={e.engine}
                      className={`block ${w.status === "closed" && e.done / e.planned < 0.9 ? "text-warn" : ""}`}
                    >
                      {engineName(e.engine)}{" "}
                      <span className="num">
                        {e.done}/{e.planned}
                      </span>{" "}
                      <span className="text-soft">{e.model}</span>
                    </span>
                  ))}
                </td>
                <td className="num">
                  {dollars(w.spent_micros)} of {dollars(w.cap_micros)}
                </td>
              </tr>
            ))}
            {waves.length === 0 && (
              <tr>
                <td colSpan={6} className="text-soft">
                  No wave yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export default function Page(props: Props) {
  return <Body {...props} />;
}
