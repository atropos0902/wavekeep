import Anthropic from "@anthropic-ai/sdk";
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

export function claudeAdapter(o: {
  apiKey: string;
  model: string;
  price: Price;
  baseURL?: string;
  estimateMicros?: number;
  fetch?: typeof fetch;
}): EngineAdapter {
  const client = new Anthropic({
    apiKey: o.apiKey,
    maxRetries: 0,
    timeout: 120_000,
    ...(o.baseURL ? { baseURL: o.baseURL } : {}),
  });
  return {
    engine: "claude",
    estimateMicros: o.estimateMicros ?? 50_000,
    async ask(req: CaptureRequest): Promise<CapturedAnswer> {
      try {
        const messages: Anthropic.MessageParam[] = [{ role: "user", content: req.question }];
        let input = 0;
        let output = 0;
        let searches = 0;
        let text = "";
        const sources: { url: string; title: string }[] = [];
        // A long search turn can pause. Send it back as it is until it finishes.
        for (let turn = 0; ; turn++) {
          const r = await client.messages.create(
            {
              model: o.model,
              max_tokens: 4096,
              messages,
              tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
            },
            req.signal ? { signal: req.signal } : undefined,
          );
          input +=
            r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0);
          output += r.usage.output_tokens;
          searches += r.usage.server_tool_use?.web_search_requests ?? 0;
          for (const b of r.content) {
            if (b.type !== "text") continue;
            text += b.text;
            for (const c of b.citations ?? [])
              if (c.type === "web_search_result_location") sources.push({ url: c.url, title: c.title ?? "" });
          }
          if (r.stop_reason !== "pause_turn" || turn >= 4) {
            if (!text) throw new Final(`empty answer (${r.stop_reason})`);
            return {
              text,
              model: r.model,
              costMicros: cost(o.price, input, output, searches),
              sources: await cleanSources(sources, o.fetch),
            };
          }
          messages.push({ role: "assistant", content: r.content });
        }
      } catch (e) {
        throw classify(e);
      }
    },
  };
}
