import { describe, expect, it } from "vitest";
import { importTranscriptsFromDirectory } from "./normalize";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("importTranscriptsFromDirectory", () => {
  it("normalizes speaker, merges consecutive turns, and redacts sensitive data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tp-roleplay-"));
    await writeFile(
      join(dir, "sample.json"),
      JSON.stringify([
        { speaker: "sales", text: "hello" },
        { speaker: "sales", text: "follow up" },
        { speaker: "client", text: "mail me at test@example.com https://example.com" },
      ]),
      "utf8"
    );

    const [transcript] = await importTranscriptsFromDirectory(dir);

    expect(transcript.turns).toHaveLength(2);
    expect(transcript.turns[0]?.speaker).toBe("sales");
    expect(transcript.turns[0]?.text).toContain("follow up");
    expect(transcript.turns[1]?.text).toContain("[REDACTED_EMAIL]");
    expect(transcript.turns[1]?.text).toContain("[REDACTED_URL]");
  });
});
