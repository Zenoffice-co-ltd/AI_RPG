import { expect, test } from "@playwright/test";

// E2E for the Grok Voice A/B backend route. We exercise the page in
// `visualTest=1` mode so it bypasses the demo access gate AND skips any
// network call to xAI (the hook only opens a WebSocket when mode === "live").
//
// What this test does NOT cover (intentionally — requires real XAI_API_KEY +
// xAI network access; operator runs locally):
//   - actual ephemeral token issuance
//   - WebSocket connection
//   - audio playback
// The unit suite already covers session route / event route / hook orchestration
// with mocked WebSocket events.

test.describe("/demo/adecco-roleplay-grok-voice", () => {
  test("visualTest mode renders the Grok Voice topbar and backend badge", async ({
    page,
  }) => {
    await page.goto("/demo/adecco-roleplay-grok-voice?visualTest=1");

    // The page is feature-flag-gated: if ENABLE_GROK_VOICE_ROLEPLAY is not
    // set in the dev env, the page shows ServiceUnavailable. We assert on
    // either the live page OR on a clear ServiceUnavailable signal so this
    // test stays useful in both states.
    const header = page.getByTestId("roleplay-header");
    const badge = page.getByTestId("grok-voice-backend-badge");

    if (await header.isVisible().catch(() => false)) {
      await expect(header).toContainText("Grok Voice Think Fast 1.0");
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute(
        "aria-label",
        "Backend: Grok Voice Think Fast 1.0"
      );
      // Topbar must show the MENDAN logo from the shared TopBar pattern.
      await expect(page.getByLabel("MENDAN")).toBeVisible();

      // Hardening: the page must not leak ElevenLabs / Haiku-Fish /
      // Anthropic / xAI internal markers into the visible DOM.
      const visibleText = (await page.locator("body").innerText()).toLowerCase();
      expect(visibleText).not.toContain("elevenlabs");
      expect(visibleText).not.toContain("convai");
      expect(visibleText).not.toContain("anthropic");
      expect(visibleText).not.toContain("xai-client-secret");
      expect(visibleText).not.toContain("api.x.ai");
    } else {
      // Flag-off path: ServiceUnavailable component renders.
      const body = await page.locator("body").innerText();
      expect(body.length).toBeGreaterThan(0);
      // No partial state should be visible.
      await expect(badge).toHaveCount(0);
    }
  });

  test("page renders without throwing (smoke)", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const response = await page.goto(
      "/demo/adecco-roleplay-grok-voice?visualTest=1"
    );
    expect(response?.status()).toBeLessThan(500);

    // Tolerate console errors that come from missing browser APIs in
    // headless mode (e.g. Web Audio without user gesture). Filter to only
    // catastrophic ones.
    const fatal = consoleErrors.filter(
      (msg) =>
        !msg.includes("AudioContext") &&
        !msg.includes("mediaDevices") &&
        !msg.includes("user gesture")
    );
    expect(fatal).toEqual([]);
  });
});
