// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { HistoryDrawer } from "../../components/roleplay/HistoryDrawer";
import { VoiceSettingsDialog } from "../../components/roleplay/VoiceSettingsDialog";

describe("roleplay dialogs", () => {
  it("opens and closes voice settings", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      createElement(VoiceSettingsDialog, {
        open: true,
        devices: [],
        selectedInput: "",
        muted: false,
        volume: 0.8,
        onClose,
        onMute: vi.fn(),
        onVolume: vi.fn(),
        onInput: vi.fn(),
      })
    );
    expect(screen.getByRole("dialog", { name: "ボイス設定" })).toBeTruthy();
    await user.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders history drawer", () => {
    render(createElement(HistoryDrawer, { open: true, items: [], onClose: vi.fn() }));
    expect(screen.getByLabelText("会話履歴")).toBeTruthy();
  });
});
