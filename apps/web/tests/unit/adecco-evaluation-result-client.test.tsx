// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdeccoEvaluationResultClient } from "../../components/roleplay/evaluation/AdeccoEvaluationResultClient";

describe("AdeccoEvaluationResultClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows timeout guidance when result polling keeps failing", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    render(
      <AdeccoEvaluationResultClient
        sessionId="gv_sess_timeout"
        mock={false}
        visualTest={false}
        debug={false}
        startFailed={false}
      />
    );

    expect(screen.getByText("採点中です")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(92_000);
    });

    expect(
      screen.getByText("まだ採点中です。しばらくして更新してください。")
    ).toBeTruthy();
  });
});
