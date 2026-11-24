import { questions } from "@wavekeep/service/web";
import { NoPermission } from "@/components/no-permission";
import { AddQuestion, MoveQuestion } from "@/components/question-forms";
import { isStaff, project } from "@/lib/server";

type Props = { params: Promise<{ project: string; pin: string }> };

async function Body({ params }: Props) {
  const { project: id, pin } = await params;
  const { ctx, project: p } = await project(id);
  if (!isStaff(ctx.role)) return <NoPermission />;
  const { items, versions } = await questions(ctx, p.id, p.questions);
  const families = Map.groupBy(items, (i) => i.family);
  const shown = Number(pin.split(".")[1]);
  return (
    <section className="py-5">
      <h1>Question set {p.questions}</h1>
      <p className="mt-1 max-w-[68ch] text-soft">
        {items.filter((i) => i.kind === "core").length} core questions make the trend.{" "}
        {items.filter((i) => i.kind === "explore").length} are exploration and stay out of it. Any change makes a new
        version, used from the next wave on.
        {shown > 0 && shown !== p.questions && ` The numbers on the other screens were asked with version ${shown}.`}
      </p>
      <AddQuestion project={p.id} version={p.questions} families={[...families.keys()]} />
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Versions">
        {versions.map((v) => (
          <li key={v.version} className="tag">
            {v.version}: {v.note}
          </li>
        ))}
      </ul>
      {[...families].map(([family, list]) => (
        <section key={family} className="sheet mt-4 overflow-x-auto" aria-label={family}>
          <h2 className="px-3 pt-3">{family}</h2>
          <table className="cells w-full">
            <thead className="sr-only">
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Used for</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {list.map((q) => (
                <tr key={q.id}>
                  <td>{q.text}</td>
                  <td className="w-28 text-soft">{q.kind === "core" ? "Core" : "Exploration"}</td>
                  <td className="w-44">
                    <MoveQuestion project={p.id} version={p.questions} question={q.id} text={q.text} kind={q.kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </section>
  );
}
export default function Page(props: Props) {
  return <Body {...props} />;
}
