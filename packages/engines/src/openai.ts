import OpenAI from "openai";
import {
  type CapturedAnswer,
  type CaptureRequest,
  classify,
  cleanSources,
  cost,
  type EngineAdapter,
  Final,
  type Price,
} from "./adapter.ts";

export function openaiAdapter(o: {
  apiKey: string;
  model: string;
  price: Price;
  baseURL?: string;
  estimateMicros?: number;
  fetch?: typeof fetch;
}): EngineAdapter {
  const client = new OpenAI({
    apiKey: o.apiKey,
    maxRetries: 0,
    timeout: 120_000,
    ...(o.baseURL ? { baseURL: o.baseURL } : {}),
  });
  return {
    engine: "openai",
    estimateMicros: o.estimateMicros ?? 50_000,
    async ask(req: CaptureRequest): Promise<CapturedAnswer> {
      try {
        const r = await client.responses.create(
          { model: o.model, input: req.question, tools: [{ type: "web_search" }], store: false },
          req.signal ? { signal: req.signal } : undefined,
        );
        if (r.status !== "completed") throw new Final(`response ${r.status}`);
        const sources: { url: string; title: string }[] = [];
        let searches = 0;
        for (const item of r.output) {
          if (item.type === "web_search_call") searches++;
          if (item.type !== "message") continue;
          for (const part of item.content)
            if (part.type === "output_text")
              for (const a of part.annotations)
                if (a.type === "url_citation") sources.push({ url: a.url, title: a.title });
        }
        const refusal = r.output
          .flatMap((i) => (i.type === "message" ? i.content : []))
          .find((c) => c.type === "refusal");
        const text = r.output_text || (refusal?.type === "refusal" ? refusal.refusal : "");
        if (!text) throw new Final("empty answer");
        return {
          text,
          model: r.model,
          costMicros: cost(o.price, r.usage?.input_tokens ?? 0, r.usage?.output_tokens ?? 0, searches),
          sources: await cleanSources(sources, o.fetch),
        };
      } catch (e) {
        throw classify(e);
      }
    },
  };
}
