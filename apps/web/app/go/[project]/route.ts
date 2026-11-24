import { pinKey } from "@wavekeep/core";
import { latestPin } from "@wavekeep/service/web";
import { redirect } from "next/navigation";
import { isStaff, project } from "@/lib/server";

export async function GET(_: Request, { params }: { params: Promise<{ project: string }> }) {
  const { ctx, project: p } = await project((await params).project);
  const pin = await latestPin(ctx, p.id);
  redirect(
    `/p/${p.id}/${pin ? pinKey(pin) : "0.0.0.0"}/${isStaff(ctx.role) ? (pin ? "overview" : "waves") : "reports"}`,
  );
}
