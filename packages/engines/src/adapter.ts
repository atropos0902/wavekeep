import { cleanUrl, type Engine } from "@wavekeep/core";

export interface CaptureRequest {
  question: string;
  questionKey: string;
  wave: number;
  repeat: number;
  signal?: AbortSignal;
}

export interface CapturedAnswer {
  text: string;
  /** The model the provider says answered, not the one we asked for. */
  model: string;
  costMicros: number;
  sources: { url: string; original: string; title: string }[];
}

export interface EngineAdapter {
  engine: Engine;
  /** Reserved against the wave's cap before the call, replaced by the real cost after it. */
  estimateMicros: number;
  ask(req: CaptureRequest): Promise<CapturedAnswer>;
}

/** Worth another try: rate limits, timeouts, provider errors. */
export class Retryable extends Error {
  override name = "Retryable";
}
/** Trying again would give the same failure. */
export class Final extends Error {
  override name = "Final";
}

export function classify(error: unknown): Error {
  if (error instanceof Retryable || error instanceof Final) return error;
  const status = (error as { status?: unknown } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429)
    return new Final(`${status}: ${message}`);
  return new Retryable(message);
}

export interface Price {
  inputPerMillion: number;
  outputPerMillion: number;
  perSearch: number;
}
/** Dollars in, millionths of a dollar out. Prices come from config and are never guessed here. */
export const cost = (p: Price, input: number, output: number, searches: number): number =>
  Math.ceil(input * p.inputPerMillion + output * p.outputPerMillion + searches * p.perSearch * 1e6);

const REDIRECT_HOSTS = new Set(["vertexaisearch.cloud.google.com"]);

/**
 * Some engines cite a redirect that expires. Read its Location once and don't follow it,
 * so a hostile page never gets a request from inside our network.
 */
export async function resolveSource(url: string, doFetch: typeof fetch = fetch): Promise<string> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  if (!REDIRECT_HOSTS.has(host)) return url;
  try {
    const res = await doFetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) });
    const to = res.headers.get("location");
    return to && cleanUrl(to) ? to : url;
  } catch {
    return url;
  }
}

export async function cleanSources(
  raw: { url: string; title: string }[],
  doFetch?: typeof fetch,
): Promise<CapturedAnswer["sources"]> {
  const out = new Map<string, CapturedAnswer["sources"][number]>();
  for (const s of raw) {
    const clean = cleanUrl(await resolveSource(s.url, doFetch));
    if (clean && !out.has(clean.url))
      out.set(clean.url, { url: clean.url, original: s.url, title: s.title.slice(0, 300) });
  }
  return [...out.values()];
}
