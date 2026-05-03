export type SseEvent = {
  event: string | null;
  data: string;
};

export async function* readSseEvents(
  body: ReadableStream<Uint8Array>
): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIdx = findEventSeparator(buffer);
      while (separatorIdx >= 0) {
        const rawEvent = buffer.slice(0, separatorIdx);
        const sepLength = buffer.slice(separatorIdx).startsWith("\r\n\r\n") ? 4 : 2;
        buffer = buffer.slice(separatorIdx + sepLength);
        const parsed = parseEventLines(rawEvent);
        if (parsed) yield parsed;
        separatorIdx = findEventSeparator(buffer);
      }
    }
    if (buffer.trim().length > 0) {
      const parsed = parseEventLines(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function findEventSeparator(buffer: string): number {
  const idxLfLf = buffer.indexOf("\n\n");
  const idxCrLf = buffer.indexOf("\r\n\r\n");
  if (idxLfLf === -1 && idxCrLf === -1) return -1;
  if (idxLfLf === -1) return idxCrLf;
  if (idxCrLf === -1) return idxLfLf;
  return Math.min(idxLfLf, idxCrLf);
}

function parseEventLines(raw: string): SseEvent | null {
  if (raw.length === 0) return null;
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0 || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

export function parseJsonOrNull(text: string): unknown {
  if (text.length === 0 || text === "[DONE]") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
