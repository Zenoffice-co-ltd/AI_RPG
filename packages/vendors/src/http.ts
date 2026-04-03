import type { z } from "zod";
import { logStructured } from "./logging";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly vendorRequestId?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type HttpRequestOptions<TSchema extends z.ZodTypeAny> = {
  scope: string;
  url: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  headers?: HeadersInit;
  body?: BodyInit | null;
  schema: TSchema;
  timeoutMs?: number;
  retries?: number;
};

function extractVendorRequestId(headers: Headers) {
  return (
    headers.get("x-request-id") ??
    headers.get("request-id") ??
    headers.get("openai-request-id") ??
    undefined
  );
}

export async function requestJson<TSchema extends z.ZodTypeAny>(
  options: HttpRequestOptions<TSchema>
): Promise<z.infer<TSchema>> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const requestInit: RequestInit = {
        method: options.method ?? "GET",
        signal: controller.signal,
      };

      if (options.headers !== undefined) {
        requestInit.headers = options.headers;
      }

      if (options.body !== undefined) {
        requestInit.body = options.body;
      }

      const response = await fetch(options.url, requestInit);

      const vendorRequestId = extractVendorRequestId(response.headers);
      const text = await response.text();
      const parsedBody: unknown = text.length > 0 ? JSON.parse(text) : null;

      if (!response.ok) {
        throw new HttpError(
          `HTTP ${response.status} for ${options.url}`,
          response.status,
          parsedBody,
          vendorRequestId
        );
      }

      const parsed = options.schema.parse(parsedBody);
      logStructured({
        scope: options.scope,
        message: "Vendor request succeeded",
        latencyMs: Date.now() - startedAt,
        ...(vendorRequestId ? { vendorRequestId } : {}),
      });
      return parsed;
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < retries &&
        (error instanceof HttpError
          ? error.status >= 500
          : error instanceof DOMException && error.name === "AbortError");

      logStructured({
        scope: options.scope,
        level: shouldRetry ? "warn" : "error",
        message: shouldRetry
          ? "Vendor request failed, retrying"
          : "Vendor request failed",
        latencyMs: Date.now() - startedAt,
        errorClass: error instanceof Error ? error.name : "UnknownError",
        ...(error instanceof HttpError && error.vendorRequestId
          ? { vendorRequestId: error.vendorRequestId }
          : {}),
        details: {
          attempt,
          url: options.url,
          status: error instanceof HttpError ? error.status : undefined,
        },
      });

      if (!shouldRetry) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}
