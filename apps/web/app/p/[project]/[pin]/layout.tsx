import { pinKey } from "@wavekeep/core";
import { readablePins } from "@wavekeep/service/web";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { signOut } from "@/lib/actions";
import { isStaff, project } from "@/lib/server";

async function Frame({ params, children }: { params: Promise<{ project: string; pin: string }>; children: ReactNode }) {
  const { project: id, pin } = await params;
  const { ctx, project: p, all } = await project(id);
  const pins = await readablePins(ctx, p.id, p.names, p.detector);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
        <span className="font-semibold tracking-tight">Wavekeep</span>
        <Nav
          projects={all.map((x) => ({ id: x.id, name: x.name }))}
          project={p.id}
          pin={pin}
          pins={pins.map(pinKey)}
          current={pins.length ? pinKey(pins.at(-1)!) : null}
          staff={isStaff(ctx.role)}
        />
        <form action={signOut} className="ml-auto flex items-center gap-3 text-soft">
          <span className="hidden sm:inline">{ctx.name}</span>
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function Layout(props: { params: Promise<{ project: string; pin: string }>; children: ReactNode }) {
  return (
    <NuqsAdapter>
      <Frame params={props.params}>{props.children}</Frame>
    </NuqsAdapter>
  );
}
