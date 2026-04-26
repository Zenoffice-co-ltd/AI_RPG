import { expect, test } from "@playwright/test";

test("adecco orb visual shell is stable", async ({ page }) => {
  await page.setViewportSize({ width: 1912, height: 1099 });
  await page.goto("/demo/adecco-orb?mock=1&visualTest=1");
  await expect(page.getByTestId("roleplay-header")).toBeVisible();
  await expect(page.getByTestId("left-orb-panel")).toBeVisible();
  await expect(page.getByTestId("right-transcript-panel")).toBeVisible();
  await expect(page.getByTestId("composer")).toBeVisible();

  await expect(page).toHaveScreenshot("adecco-orb-full.png", {
    maxDiffPixelRatio: 0.005,
    animations: "disabled",
  });
  await expect(page.getByTestId("roleplay-header")).toHaveScreenshot(
    "adecco-orb-header.png",
    { maxDiffPixelRatio: 0.005, animations: "disabled" }
  );
  await expect(page.getByTestId("left-orb-panel")).toHaveScreenshot(
    "adecco-orb-left-panel.png",
    { maxDiffPixelRatio: 0.005, animations: "disabled" }
  );
  await expect(page.getByTestId("right-transcript-panel")).toHaveScreenshot(
    "adecco-orb-right-panel.png",
    { maxDiffPixelRatio: 0.005, animations: "disabled" }
  );
  await expect(page.getByTestId("composer")).toHaveScreenshot(
    "adecco-orb-composer.png",
    { maxDiffPixelRatio: 0.005, animations: "disabled" }
  );
});
