import { z } from "zod";

export const ENGINES = ["openai", "gemini", "claude"] as const;
export type Engine = (typeof ENGINES)[number];
export const ENGINE_LABEL: Record<Engine, string> = {
  openai: "OpenAI API",
  gemini: "Gemini API",
  claude: "Claude API",
};

export const METRICS = ["named", "recommended", "cited"] as const;
export type Metric = (typeof METRICS)[number];
export const METRIC_LABEL: Record<Metric, string> = {
  named: "Named",
  recommended: "Recommended",
  cited: "Own site cited",
};

export const KINDS = ["core", "explore"] as const;
export type QuestionKind = (typeof KINDS)[number];

export const FilterSchema = z.object({
  engines: z.array(z.enum(ENGINES)).optional(),
  families: z.array(z.uuid()).optional(),
  kind: z.enum(KINDS).default("core"),
});
export type Filter = z.infer<typeof FilterSchema>;
