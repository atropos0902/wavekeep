import { type Engine, hashSeed, seeded } from "@wavekeep/core";
import type { CapturedAnswer, RecordingSource } from "@wavekeep/engines";

/** Made-up employers, questions and answers. Nothing here comes from a real engine. */

export const FAMILIES = [
  "Starting pay",
  "Night shifts",
  "Nurse to patient ratio",
  "New graduate support",
  "Visa sponsorship",
  "Paid training",
  "Parking and commute",
  "Schedule control",
  "Weekend rota",
  "Union rules",
  "Career ladder",
  "Safety on shift",
  "Manager turnover",
  "Retirement match",
  "Childcare help",
  "Parental leave",
  "Sign-on bonus",
  "Remote admin work",
  "Part-time options",
  "Continuing education",
  "Burnout and breaks",
  "Equipment quality",
  "Transfer between sites",
  "Interview speed",
  "Rehire after leave",
];
export const ROLES = ["nurses", "lab technicians", "front desk staff", "pharmacists"];

export interface Profile {
  brand: string;
  /** Ways the answers write the name. */
  forms: string[];
  domain: string;
  /** Log-odds of being named, by engine. */
  base: Partial<Record<Engine, number>>;
  recommended: number;
  cited: number;
}
export interface WaveShape {
  /** Added to a brand's log-odds. */
  lift?: Record<string, number>;
  failing?: Partial<Record<Engine, number>>;
  model?: Partial<Record<Engine, string>>;
}

const OPEN = [
  "Here's what current and former staff tend to say.",
  "There isn't one answer, but a few employers come up often.",
  "It depends on the unit. These are the names worth looking at:",
  "I looked at recent reviews and job pages.",
  "Pay bands differ by site, so treat this as a starting point. 🙂",
  "Short version first, then the detail 👇",
];
const PLAIN = [
  "Staff at {b} describe steady hours and a clear rota.",
  "Working at {b} is mentioned in several review threads.",
  "Nurses at {b} report mixed experiences on this.",
  "{b} has several open roles in this area.",
  "Jobs at {b} list this on the posting itself.",
  "**{b}** employees bring this up in reviews.",
];
const GOOD = [
  "For this one I'd recommend {b}, whose staff rate it highly.",
  "{b} is the best choice if this matters most to you.",
  "{b} stands out: employees say it keeps its promises here.",
  "A strong choice is {b}, where managers publish the policy.",
];
const DECOY = [
  "Ask for the summit of the pay band in writing.",
  "A good mentor is a beacon in the first year.",
  "Some units feel like a safe harbor, others don't.",
  "The summit week in spring is a busy one for hiring.",
];
const CLOSE = [
  "Check the posting before you apply.",
  "Ask about it in the first interview.",
  "Rules change, so confirm with the recruiter.",
  "",
];
const OTHER_HOSTS = [
  "nursereviews.example",
  "jobboard.example",
  "citypaper.example",
  "forum.example",
  "stateboard.example",
  "salarydata.example",
];

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
const pick = <T>(xs: readonly T[], r: () => number): T => xs[Math.floor(r() * xs.length)]!;
const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

export function syntheticAnswer(
  profiles: Profile[],
  shape: WaveShape,
  engine: Engine,
  family: string,
  key: string,
  wave: number,
  repeat: number,
): CapturedAnswer {
  const r = seeded(hashSeed(`${engine}|${key}|${wave}|${repeat}`));
  const lines: string[] = [];
  const sources: CapturedAnswer["sources"] = [];
  const cite = (host: string, path: string, title: string): void => {
    const url = `https://${host}/${path}`;
    if (!sources.some((s) => s.url === url))
      sources.push({ url, original: engine === "openai" ? `${url}?utm_source=openai` : url, title });
  };
  for (const p of profiles) {
    const taste = gauss(seeded(hashSeed(`${p.brand}|${family}`))) * 0.9;
    const named = r() < logistic((p.base[engine] ?? -1.5) + taste + (shape.lift?.[p.brand] ?? 0));
    if (named) lines.push((r() < p.recommended ? pick(GOOD, r) : pick(PLAIN, r)).replace("{b}", pick(p.forms, r)));
    if (r() < (named ? p.cited : p.cited / 4))
      cite(
        r() < 0.5 ? p.domain : `careers.${p.domain}`,
        pick(["benefits", "jobs", "nursing"], r),
        `${p.brand} careers`,
      );
  }
  if (r() < 0.5) lines.push(pick(DECOY, r));
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [lines[i], lines[j]] = [lines[j]!, lines[i]!];
  }
  for (let i = 0; i < 1 + Math.floor(r() * 2); i++)
    cite(pick(OTHER_HOSTS, r), `${pick(["guide", "thread", "survey"], r)}-${1 + Math.floor(r() * 9)}`, "Discussion");
  const body = lines.length
    ? lines.map((l) => `- ${l}`).join("\n")
    : "No employer is mentioned consistently enough to name one.";
  return {
    text: `${pick(OPEN, r)}\n\n${body}\n\n${pick(CLOSE, r)}`.trim(),
    model: shape.model?.[engine] ?? `synthetic-${engine}-1`,
    costMicros: 800 + Math.floor(r() * 400),
    sources,
  };
}

export function syntheticSource(
  profiles: Profile[],
  families: Map<string, string>,
  shapes: WaveShape[],
): RecordingSource {
  return (engine, req) => {
    const shape = shapes[req.wave - 1] ?? {};
    const lost = seeded(hashSeed(`lost|${engine}|${req.question}|${req.wave}|${req.repeat}`))();
    if (lost < (shape.failing?.[engine] ?? 0)) return { fail: "final", message: "429: rate limit" };
    return {
      ok: syntheticAnswer(
        profiles,
        shape,
        engine,
        families.get(req.questionKey) ?? "",
        req.question,
        req.wave,
        req.repeat,
      ),
    };
  };
}

export const HOSPITALS: Profile[] = [
  {
    brand: "Saint Mary's Health",
    forms: ["Saint Mary's Health", "Saint Mary’s Health", "St. Mary’s"],
    domain: "saintmarys.example",
    base: { openai: 0, gemini: -1.75 },
    recommended: 0.35,
    cited: 0.4,
  },
  {
    brand: "Summit",
    forms: ["Summit"],
    domain: "summit-hospitals.example",
    base: { openai: 0.4, gemini: 0.1 },
    recommended: 0.4,
    cited: 0.45,
  },
  {
    brand: "Lakeside Medical Center",
    forms: ["Lakeside Medical Center", "Lakeside Medical"],
    domain: "lakesidemed.example",
    base: { openai: -0.4, gemini: 0.2 },
    recommended: 0.25,
    cited: 0.3,
  },
  {
    brand: "Harbor Clinic Group",
    forms: ["Harbor Clinic Group", "Harbor Clinic"],
    domain: "harborclinic.example",
    base: { openai: -1, gemini: -0.8 },
    recommended: 0.2,
    cited: 0.25,
  },
  {
    brand: "Beacon",
    forms: ["Beacon"],
    domain: "beaconcare.example",
    base: { openai: -1.6, gemini: -1.2 },
    recommended: 0.15,
    cited: 0.2,
  },
];
