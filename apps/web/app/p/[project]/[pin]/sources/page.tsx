import { Filters } from "@/components/filters";
import { NoPermission, NoWave } from "@/components/no-permission";
import { SortTable } from "@/components/sort-table";
import { filterOf, isStaff, pinOf, project, read, type Search } from "@/lib/server";

type Props = { params: Promise<{ project: string; pin: string }>; searchParams: Promise<Search> };

async function Body({ params, searchParams }: Props) {
  const { project: id, pin: text } = await params;
  const { ctx, project: p } = await project(id);
  if (!isStaff(ctx.role)) return <NoPermission />;
  if (text === "0.0.0.0") return <NoWave />;
  const pin = pinOf(text);
  const s = await read.sources(ctx, p.id, pin, filterOf(await searchParams));
  const o = await read.overview(ctx, p.id, pin, { kind: "core" });
  const own = s.hosts.filter((h) => h.own).length;
  return (
    <>
      <Filters engines={o.engines.map((e) => e.engine)} />
      <h1>Where the answers came from</h1>
      <p className="mt-1 max-w-[68ch] text-soft">
        <span className="num">{s.cited}</span> of <span className="num">{s.answers}</span> answers cite at least one
        page. Links are cleaned when the answer is captured, and the original is kept with it. {own} of these sites
        belong to {p.name}.
      </p>
      {s.hosts.length === 0 ? (
        <p className="sheet mt-4 p-4 text-soft">No answer under these filters cites a page.</p>
      ) : (
        <>
          <SortTable
            title="Sites"
            columns={[
              { key: "host", label: "Site" },
              { key: "owner", label: "Belongs to" },
              { key: "pages", label: "Pages", number: true },
              { key: "answers", label: "Answers citing it", number: true },
            ]}
            rows={s.hosts.map((h) => ({
              host: h.host,
              owner: h.owner ?? "Someone else",
              pages: h.pages,
              answers: h.answers,
            }))}
          />
          <SortTable
            title="Pages"
            columns={[
              { key: "url", label: "Page" },
              { key: "title", label: "Title" },
              { key: "answers", label: "Answers citing it", number: true },
            ]}
            rows={s.pages.map((x) => ({ url: x.url, title: x.title, answers: x.answers }))}
          />
        </>
      )}
    </>
  );
}
export default function Page(props: Props) {
  return <Body {...props} />;
}
