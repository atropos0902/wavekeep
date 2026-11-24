"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const STAFF = ["overview", "compare", "sources", "questions", "names", "waves", "reports"];

export function Nav(p: {
  projects: { id: string; name: string }[];
  project: string;
  pin: string;
  pins: string[];
  current: string | null;
  staff: boolean;
}) {
  const path = usePathname();
  const query = useSearchParams();
  const router = useRouter();
  const screen = path.split("/")[4] ?? "overview";
  const [wave, questions, names, detector] = p.pin.split(".");
  const old = p.current !== null && p.pin.split(".").slice(2).join(".") !== p.current.split(".").slice(2).join(".");
  const carry = new URLSearchParams([...query].filter(([k]) => ["kind", "engines", "families"].includes(k))).toString();
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="sr-only">Project</span>
        <select className="field" value={p.project} onChange={(e) => router.push(`/go/${e.target.value}`)}>
          {p.projects.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {p.staff && p.pins.length > 0 && (
        <label className="flex items-center gap-2">
          <span className="sr-only">Wave</span>
          <select
            className="field"
            value={p.pin}
            onChange={(e) => router.push(`/p/${p.project}/${e.target.value}/${screen}${carry ? `?${carry}` : ""}`)}
          >
            {!p.pins.includes(p.pin) && (
              <option value={p.pin}>{p.pin === "0.0.0.0" ? "No wave yet" : `Wave ${wave}`}</option>
            )}
            {p.pins.map((x) => (
              <option key={x} value={x}>
                Wave {x.split(".")[0]}
              </option>
            ))}
          </select>
        </label>
      )}
      {p.staff && p.pin !== "0.0.0.0" && (
        <span
          className={`tag ${old ? "bg-warn-bg !text-warn" : ""}`}
          title="These four identify every number on the page"
        >
          Questions {questions}, names {names}, detector {detector}
          {old ? " (older)" : ""}
        </span>
      )}
      <nav aria-label="Screens" className="order-last flex w-full gap-1 overflow-x-auto border-b border-line">
        {(p.staff ? STAFF : ["reports"]).map((s) => (
          <Link
            key={s}
            prefetch={false}
            href={`/p/${p.project}/${p.pin}/${s}${carry && ["overview", "compare", "sources"].includes(s) ? `?${carry}` : ""}`}
            aria-current={screen === s ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 capitalize ${screen === s ? "border-own font-semibold" : "border-transparent text-soft hover:text-ink"}`}
          >
            {s}
            <Pending />
          </Link>
        ))}
      </nav>
    </>
  );
}

/** The old screen stays up while the next one loads, with a mark on the tab that was pressed. */
function Pending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={`ml-1.5 inline-block size-1.5 rounded-full align-middle ${pending ? "pulse !bg-own" : "opacity-0"}`}
    />
  );
}
