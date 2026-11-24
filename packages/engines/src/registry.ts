import type { Engine } from "@wavekeep/core";
import { z } from "zod";
import type { EngineAdapter } from "./adapter.ts";
import { claudeAdapter } from "./claude.ts";
import { geminiAdapter } from "./gemini.ts";
import { openaiAdapter } from "./openai.ts";

const Price = z.object({ inputPerMillion: z.number(), outputPerMillion: z.number(), perSearch: z.number() });
const One = z.object({ model: z.string(), price: Price, estimateMicros: z.number().int().positive() });
/** WAVEKEEP_ENGINES, JSON. A live engine without a price is refused, since the cap couldn't be kept. */
export const LiveConfig = z.object({ openai: One.optional(), gemini: One.optional(), claude: One.optional() });

export function liveAdapters(env: Record<string, string | undefined>): Map<Engine, EngineAdapter> {
  const out = new Map<Engine, EngineAdapter>();
  if (!env.WAVEKEEP_ENGINES) return out;
  const c = LiveConfig.parse(JSON.parse(env.WAVEKEEP_ENGINES));
  const key = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`${name} is required for the engine in WAVEKEEP_ENGINES`);
    return v;
  };
  if (c.openai) out.set("openai", openaiAdapter({ apiKey: key("OPENAI_API_KEY"), ...c.openai }));
  if (c.gemini) out.set("gemini", geminiAdapter({ apiKey: key("GEMINI_API_KEY"), ...c.gemini }));
  if (c.claude) out.set("claude", claudeAdapter({ apiKey: key("ANTHROPIC_API_KEY"), ...c.claude }));
  return out;
}
