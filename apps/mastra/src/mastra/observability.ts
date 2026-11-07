import type {
  AnyExportedSpan,
  ObservabilityExporter,
  TracingEvent,
} from "@mastra/core/observability";
import {
  MastraPlatformExporter,
  MastraStorageExporter,
  Observability,
} from "@mastra/observability";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reconstruct rather than blacklist: new SDK fields must not silently disclose
// content. Run IDs are opaque backend-generated UUIDs, never Telegram/user IDs.
export function privateSpan(span: AnyExportedSpan): AnyExportedSpan {
  const runId = span.metadata?.runId;
  const usage = (span.attributes as { usage?: Record<string, unknown> } | undefined)?.usage;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  return {
    id: span.id,
    traceId: span.traceId,
    parentSpanId: span.parentSpanId,
    name: span.type,
    type: span.type,
    startTime: span.startTime,
    endTime: span.endTime,
    isEvent: span.isEvent,
    isRootSpan: span.isRootSpan,
    outcome: ["success", "error", "failed", "suspended", "running", "canceled"].includes(
      span.outcome ?? "",
    )
      ? span.outcome
      : undefined,
    attributes: usage
      ? {
          usage: {
            inputTokens: count(usage.inputTokens),
            outputTokens: count(usage.outputTokens),
          },
        }
      : undefined,
    metadata: typeof runId === "string" && uuid.test(runId) ? { runId } : {},
    // Error messages/stacks/details and even span names can include note text.
    errorInfo: span.errorInfo ? { message: "Operation failed" } : undefined,
    inputPreview: "",
    outputPreview: "",
    errorPreview: span.errorInfo ? "Operation failed" : "",
  };
}

// Only sanitized tracing events cross this boundary. Logs, metrics, scores and
// feedback have separate payloads/metadata, so they are deliberately not forwarded.
export function privateTraceExporter(target: ObservabilityExporter): ObservabilityExporter {
  const send = (event: TracingEvent) =>
    target.exportTracingEvent({ type: event.type, exportedSpan: privateSpan(event.exportedSpan) });
  return {
    name: `private-${target.name}`,
    init: (options) => target.init?.(options),
    __setLogger: (logger) => target.__setLogger?.(logger),
    onTracingEvent: send,
    exportTracingEvent: send,
    flush: () => target.flush(),
    shutdown: () => target.shutdown(),
  };
}

export function createObservability() {
  return new Observability({
    configs: {
      default: {
        serviceName: "ai-scouting-mastra",
        logging: { enabled: false },
        exporters: [
          privateTraceExporter(new MastraStorageExporter()),
          privateTraceExporter(new MastraPlatformExporter()),
        ],
      },
    },
  });
}
