// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../../components/roleplay/Composer";

describe("Composer", () => {
  it("sends on Enter and keeps Shift+Enter as newline", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(createElement(Composer, { onSend }));

    const input = screen.getByLabelText("メッセージを送信");
    await user.type(input, "こんにちは{Shift>}{Enter}{/Shift}続き");
    expect((input as HTMLTextAreaElement).value).toBe("こんにちは\n続き");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("こんにちは\n続き");
  });

  it("does not send whitespace-only input", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(createElement(Composer, { onSend }));

    await user.type(screen.getByLabelText("メッセージを送信"), "   ");
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });
});
