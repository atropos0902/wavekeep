import { GoogleGenAI } from "@google/genai";
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

export function geminiAdapter(o: {
  apiKey: string;
  model: string;
  price: Price;
  baseURL?: string;
  estimateMicros?: number;
  fetch?: typeof fetch;
}): EngineAdapter {
  const client = new GoogleGenAI({
    apiKey: o.apiKey,
    httpOptions: { timeout: 120_000, ...(o.baseURL ? { baseUrl: o.baseURL } : {}) },
  });
  return {
    engine: "gemini",
    estimateMicros: o.estimateMicros ?? 50_000,
    async ask(req: CaptureRequest): Promise<CapturedAnswer> {
      try {
        const r = await client.models.generateContent({
          model: o.model,
          contents: req.question,
          config: { tools: [{ googleSearch: {} }], ...(req.signal ? { abortSignal: req.signal } : {}) },
        });
        const text = r.text ?? "";
        if (!text) throw new Final("empty answer");
        const meta = r.candidates?.[0]?.groundingMetadata;
        const sources = (meta?.groundingChunks ?? []).flatMap((c) =>
          c.web?.uri ? [{ url: c.web.uri, title: c.web.title ?? "" }] : [],
        );
        const u = r.usageMetadata;
        return {
          text,
          model: r.modelVersion ?? o.model,
          costMicros: cost(
            o.price,
            u?.promptTokenCount ?? 0,
            (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
            meta?.webSearchQueries?.length ?? 0,
          ),
          sources: await cleanSources(sources, o.fetch),
        };
      } catch (e) {
        throw classify(e);
      }
    },
  };
}
