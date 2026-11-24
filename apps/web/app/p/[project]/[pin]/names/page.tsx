import { readNameSet } from "@wavekeep/service/web";
import { NamesForm } from "@/components/names-form";
import { NoPermission } from "@/components/no-permission";
import { isStaff, project } from "@/lib/server";

type Props = { params: Promise<{ project: string }> };

async function Body({ params }: Props) {
  const { ctx, project: p } = await project((await params).project);
  if (!isStaff(ctx.role)) return <NoPermission />;
  const set = await readNameSet(ctx, p.id, p.names);
  return (
    <section className="py-5">
      <h1>Names, version {p.names}</h1>
      <p className="mt-1 max-w-[68ch] text-soft">
        Saving counts every closed wave again under the new names, then switches all of them together. Approved reports
        keep the version they were approved with. End a name with a question mark when it's also an everyday word.
      </p>
      <NamesForm key={p.names} project={p.id} version={p.names} brands={set} />
    </section>
  );
}
export default function Page(props: Props) {
  return <Body {...props} />;
}
