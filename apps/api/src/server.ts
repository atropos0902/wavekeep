import { serve } from "@hono/node-server";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { makePool } from "@wavekeep/service";
import { Hono } from "hono";
import { makeApi } from "./app.ts";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  new NodeSDK({ serviceName: "wavekeep-api", traceExporter: new OTLPTraceExporter() }).start();
const tracer = trace.getTracer("wavekeep-api");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = makePool(url, Number(process.env.POOL ?? 10));
const root = new Hono();
root.use("*", (c, next) =>
  tracer.startActiveSpan(
    `${c.req.method} ${new URL(c.req.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`,
    { kind: SpanKind.SERVER },
    async (span) => {
      await next();
      span.setAttribute("http.response.status_code", c.res.status);
      if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    },
  ),
);
root.route("/", makeApi(pool));
const server = serve(
  { fetch: root.fetch, port: Number(process.env.PORT ?? 4311), hostname: process.env.HOST ?? "127.0.0.1" },
  (i) => console.log(`api on ${i.port}`),
);
process.on("SIGTERM", () => server.close(() => pool.end().then(() => process.exit(0))));
