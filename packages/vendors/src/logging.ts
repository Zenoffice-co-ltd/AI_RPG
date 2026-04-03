export type LogLevel = "info" | "warn" | "error";

export type StructuredLog = {
  message: string;
  level?: LogLevel;
  scope: string;
  sessionId?: string;
  liveavatarSessionId?: string;
  scenarioId?: string;
  elevenAgentId?: string;
  analysisVersion?: string;
  promptVersion?: string;
  vendorRequestId?: string;
  latencyMs?: number;
  errorClass?: string;
  details?: Record<string, unknown>;
};

export function logStructured(entry: StructuredLog): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level: entry.level ?? "info",
    ...entry,
  };

  const line = JSON.stringify(payload);

  switch (entry.level) {
    case "warn":
      console.warn(line);
      return;
    case "error":
      console.error(line);
      return;
    default:
      console.info(line);
  }
}
