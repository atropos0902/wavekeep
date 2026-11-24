"use server";
import { ENGINES, type Engine, parsePin, type QuestionKind } from "@wavekeep/core";
import * as service from "@wavekeep/service/web";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { boss, COOKIE, pool, session } from "./server.ts";

export interface Said {
  error?: string;
  ok?: string;
}
const text = (f: FormData, k: string): string => String(f.get(k) ?? "");

async function say(f: () => Promise<string>): Promise<Said> {
  try {
    return { ok: await f() };
  } catch (e) {
    if (e instanceof Error && ["NotFound", "Forbidden", "Conflict", "Invalid"].includes(e.name))
      return { error: e.message };
    throw e;
  }
}

export async function signIn(_: Said, f: FormData): Promise<Said> {
  const token = await service.signIn(pool(), text(f, "email"), text(f, "password"));
  if (!token) return { error: "That email and password don't match." };
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.SECURE_COOKIES === "1",
    path: "/",
  });
  redirect("/");
}
export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await service.signOut(await session(), token);
  jar.delete(COOKIE);
  redirect("/sign-in");
}

export async function startWave(project: string, _: Said, f: FormData): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    const engines = f
      .getAll("engines")
      .map(String)
      .filter((e): e is Engine => (ENGINES as readonly string[]).includes(e));
    const w = await service.startWave(ctx, await boss(), project, {
      engines,
      repeats: Number(text(f, "repeats")),
      capMicros: Math.round(Number(text(f, "cap")) * 1e6),
    });
    return `Wave ${w.seq} started with ${w.captures} captures.`;
  });
}

export async function draftReport(project: string, pin: string, _: Said, f: FormData): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    const p = parsePin(pin);
    if (!p) throw new service.Invalid("This page has no pin.");
    await service.draftReport(ctx, project, { title: text(f, "title"), pin: p, note: text(f, "note") });
    return "Draft saved.";
  });
}
export async function editReport(id: string, _: Said, f: FormData): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    const r = await service.editReport(ctx, id, Number(text(f, "revision")), {
      title: text(f, "title"),
      note: text(f, "note"),
    });
    return `Saved as revision ${r}.`;
  });
}
export async function submitReport(id: string, revision: number): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    await service.submitReport(ctx, id, revision);
    return "Sent for review.";
  });
}
export async function approveReport(id: string, revision: number): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    await service.approveReport(ctx, id, revision);
    return "Approved. Its numbers are fixed now.";
  });
}
export async function shareReport(id: string): Promise<Said> {
  const ctx = await session();
  return say(async () => `/r/${await service.shareReport(ctx, id)}`);
}
export async function revokeLink(id: string): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    await service.revokeLink(ctx, id);
    return "The link no longer opens.";
  });
}

export async function changeQuestion(
  project: string,
  version: number,
  question: string,
  kind: QuestionKind,
): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    const v = await service.changeQuestions(ctx, project, version, {
      move: [{ question, kind }],
      note: kind === "core" ? "Moved a question into the core" : "Moved a question to exploration",
    });
    return `Question set ${v} is ready for the next wave.`;
  });
}
export async function addQuestion(project: string, version: number, _: Said, f: FormData): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    const q = text(f, "text").trim();
    const family = text(f, "family").trim();
    if (!q || !family) throw new service.Invalid("A question needs its text and a family.");
    const v = await service.changeQuestions(ctx, project, version, {
      add: [{ family, text: q, kind: "explore" }],
      note: "Added a question to exploration",
    });
    return `Question set ${v} is ready for the next wave.`;
  });
}

export async function saveNames(project: string, from: number, _: Said, f: FormData): Promise<Said> {
  const ctx = await session();
  return say(async () => {
    const set = await service.readNameSet(ctx, project, from);
    const lines = (k: string): string[] => [
      ...new Set(
        text(f, k)
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    ];
    const v = await service.addNameSet(
      ctx,
      project,
      set.map((b) => ({
        brand: b.id,
        names: lines(`names:${b.id}`).map((l) =>
          l.endsWith("?") ? { name: l.slice(0, -1).trim(), needsContext: true } : { name: l },
        ),
        domains: lines(`domains:${b.id}`),
      })),
      text(f, "note"),
    );
    const n = await service.publish(ctx, project, v, service.CURRENT_DETECTOR);
    return `Names ${v} counted over ${n.waves} waves and published.`;
  });
}
