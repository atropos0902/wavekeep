import { parsePin } from "@wavekeep/core";
import { listReports, type ReportPayload, wouldSayNow } from "@wavekeep/service/web";
import { DraftReport, ReportActions } from "@/components/report-forms";
import { ReportBody } from "@/components/report-body";
import { rateText } from "@/lib/format";
import { isStaff, project } from "@/lib/server";

type Props = { params: Promise<{ project: string; pin: string }> };

async function Body({ params }: Props) {
  const { project: id, pin } = await params;
  const { ctx, project: p } = await project(id);
  const staff = isStaff(ctx.role);
  const reports = await listReports(ctx, p.id);
  const drift = new Map<string, ReportPayload>();
  if (staff)
    for (const r of reports.filter((x) => x.status === "approved")) {
      const now = await wouldSayNow(ctx, r.id);
      if (now) drift.set(r.id, now);
    }
  const order = { draft: 0, in_review: 1, approved: 2 };
  const label = { draft: "Draft", in_review: "In review", approved: "Approved" };
  return (
    <section className="py-5">
      <h1>Reports</h1>
      {staff && parsePin(pin) && pin !== "0.0.0.0" && <DraftReport project={p.id} pin={pin} wave={pin.split(".")[0]!} />}
      {reports.length === 0 && <p className="mt-3 text-soft">{staff ? "No reports yet." : "No report has been approved for you yet."}</p>}
      {reports
        .toSorted((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title))
        .map((r) => {
          const payload = r.payload ? (JSON.parse(r.payload) as ReportPayload) : null;
          const now = drift.get(r.id);
          const own = now?.brands.find((b) => b.own);
          const then = payload?.brands.find((b) => b.own);
          return (
            <article key={r.id} className="sheet mt-4 p-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2>{r.title}</h2>
                <span className="tag">{label[r.status]}</span>
                <span className="text-soft">Wave {r.pin.split(".")[0]}, names {r.pin.split(".")[2]}, revision <span className="num">{r.revision}</span></span>
              </div>
              {payload ? <ReportBody payload={payload} /> : <p className="mt-2 max-w-[68ch]">{r.note}</p>}
              {own && then && (
                <p className="mt-3 rounded bg-warn-bg px-3 py-2 text-warn">
                  Under names {now!.pin.split(".")[2]} and detector {now!.pin.split(".")[3]}, {own.label} would read <span className="num">{rateText(own.rates.named)}</span> and not <span className="num">{rateText(then.rates.named)}</span>. This report stays as approved.
                </p>
              )}
              {staff && <ReportActions id={r.id} revision={r.revision} status={r.status} title={r.title} note={r.note} owner={ctx.role === "owner"} links={r.links} />}
            </article>
          );
        })}
    </section>
  );
}
export default function Page(props: Props) {
  return (
    <Body {...props} />
  );
}
