import { pinKey } from "@wavekeep/core";
import { latestPin, listProjects } from "@wavekeep/service/web";
import { redirect } from "next/navigation";
import { isStaff, session } from "@/lib/server";

async function Go() {
  const ctx = await session();
  const projects = await listProjects(ctx);
  const first = projects.find((p) => p.name.startsWith("Saint")) ?? projects[0];
  if (!first) return <p className="p-8">This workspace has no projects yet.</p>;
  const pin = await latestPin(ctx, first.id);
  redirect(
    `/p/${first.id}/${pin ? pinKey(pin) : "0.0.0.0"}/${isStaff(ctx.role) ? (pin ? "overview" : "waves") : "reports"}`,
  );
  return null;
}
export default function Home() {
  return <Go />;
}
