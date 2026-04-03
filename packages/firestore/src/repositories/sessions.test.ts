import { describe, expect, it } from "vitest";
import { decideAnalysisTransition } from "./sessions";

describe("decideAnalysisTransition", () => {
  it("acquires a lock for transcript_ready sessions", () => {
    expect(decideAnalysisTransition("transcript_ready")).toEqual({
      lockAcquired: true,
      nextStatus: "analysis_running",
    });
  });

  it("does not reacquire a lock for analysis_running sessions", () => {
    expect(decideAnalysisTransition("analysis_running")).toEqual({
      lockAcquired: false,
      nextStatus: "analysis_running",
    });
  });

  it("does not reacquire a lock for completed sessions", () => {
    expect(decideAnalysisTransition("completed")).toEqual({
      lockAcquired: false,
      nextStatus: "completed",
    });
  });
});
