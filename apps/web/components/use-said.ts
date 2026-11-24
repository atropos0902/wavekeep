"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import type { Said } from "@/lib/actions";

/**
 * A form action whose success reloads the screen's data.
 *
 * No Suspense boundary may sit around a screen's body. On this version of Next a refreshed body inside one
 * was fetched and then not shown, about one time in four. e2e/refresh.spec.ts holds that.
 */
export function useSaid<Input>(act: (said: Said, input: Input) => Promise<Said>) {
  const router = useRouter();
  const [said, run, busy] = useActionState(act, {} as Awaited<Said>);
  useEffect(() => {
    if (said.ok) router.refresh();
  }, [said, router]);
  return [said, run as (input: Input) => void, busy] as const;
}
