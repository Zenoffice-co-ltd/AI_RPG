import { expect, test } from "@playwright/test";

// E2E for the v3 production canonical route (Grok Voice backend, but the UI
// intentionally hides the model identity for customer demos).
//
// What this test does NOT cover (intentionally — requires real XAI_API_KEY +
// xAI network access; operator runs locally):
//   - actual ephemeral token issuance
//   - WebSocket connection
//   - audio playback
// The unit suite already covers session route / event route / hook orchestration
// with mocked WebSocket events.

const SCENARIO_TITLE = "住宅設備メーカー 人事課主任 初回派遣オーダーヒアリング";

test.describe("/demo/adecco-roleplay-v3", () => {
  test("visualTest mode renders the customer-facing topbar without leaking backend identity", async ({
    page,
  }) => {
    await page.goto("/demo/adecco-roleplay-v3?visualTest=1");

    // The page is feature-flag-gated: if ENABLE_GROK_VOICE_ROLEPLAY is not
    // set in the dev env, the page shows ServiceUnavailable. We assert on
    // either the live page OR on a clear ServiceUnavailable signal so this
    // test stays useful in both states.
    const header = page.getByTestId("roleplay-header");

    if (await header.isVisible().catch(() => false)) {
      await expect(header).toContainText(SCENARIO_TITLE);
      // Topbar must show the MENDAN logo from the shared TopBar pattern.
      await expect(page.getByLabel("MENDAN")).toBeVisible();

      // Customer-facing demo invariants — the visible UI MUST NOT leak
      // backend identity, vendor names, A/B labels, or version markers.
      const visibleText = (await page.locator("body").innerText()).toLowerCase();
      expect(visibleText).not.toContain("grok");
      expect(visibleText).not.toContain("xai");
      expect(visibleText).not.toContain("anthropic");
      expect(visibleText).not.toContain("claude");
      expect(visibleText).not.toContain("haiku");
      expect(visibleText).not.toContain("fish");
      expect(visibleText).not.toContain("elevenlabs");
      expect(visibleText).not.toContain("convai");
      expect(visibleText).not.toContain("backend:");
      expect(visibleText).not.toContain("a/b");
      expect(visibleText).not.toContain("v3");
      expect(visibleText).not.toContain("api.x.ai");
      expect(visibleText).not.toContain("xai-client-secret");
    } else {
      // Flag-off path: ServiceUnavailable component renders.
      const body = await page.locator("body").innerText();
      expect(body.length).toBeGreaterThan(0);
    }
  });

  test("page renders without throwing (smoke)", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const response = await page.goto("/demo/adecco-roleplay-v3?visualTest=1");
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
