"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Now {
  seq: number;
  status: string;
  counted: boolean;
  planned: number;
  done: number;
  failed: number;
}

export function WaveProgress({ project }: { project: string }) {
  const [now, setNow] = useState<Now | null>(null);
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/waves?project=${project}`);
        const w = (await res.json()) as Now | null;
        if (stop) return;
        setNow(w);
        if (w?.status === "closed" && w.counted) {
          router.push(`/go/${project}`);
          return;
        }
      } catch {}
      if (!stop) setTimeout(() => void tick(), 1500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [project, router]);
  if (!now)
    return (
      <p className="sheet mt-4 p-4 text-soft" role="status">
        Reading progress
      </p>
    );
  return (
    <div className="sheet mt-4 p-4">
      <label className="flex flex-col gap-2">
        <span>
          Wave {now.seq}: <span className="num">{now.done}</span> completed, <span className="num">{now.failed}</span>{" "}
          failed, of <span className="num">{now.planned}</span>
        </span>
        <progress className="h-2 w-full accent-[var(--color-own)]" max={now.planned} value={now.done + now.failed} />
      </label>
      <p className="mt-1 text-soft" role="status">
        {now.status === "open" ? "Capturing" : "Closed, counting mentions"}
      </p>
    </div>
  );
}
