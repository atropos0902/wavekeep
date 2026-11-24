import { openShared, type ReportPayload } from "@wavekeep/service/web";
import { notFound } from "next/navigation";
import { ReportBody } from "@/components/report-body";
import { pool } from "@/lib/server";

async function Body({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await openShared(pool(), token);
  if (!found) notFound();
  const payload = JSON.parse(found.payload) as ReportPayload;
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-soft">{payload.project}</p>
      <h1>{found.title}</h1>
      <ReportBody payload={payload} />
    </main>
  );
}
export default function Page(props: { params: Promise<{ token: string }> }) {
  return <Body {...props} />;
}
