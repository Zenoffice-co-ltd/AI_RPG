import { expect, test } from "@playwright/test";

test("home page renders scenario cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("シナリオ一覧")).toBeVisible();
  await expect(page.getByText("忙しい現場責任者")).toBeVisible();
});
