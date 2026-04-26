import { expect, test } from "@playwright/test";

test("adecco orb mock mode renders and supports controls", async ({ page }) => {
  await page.goto("/demo/adecco-roleplay?mock=1");
  await expect(page.getByTestId("roleplay-header")).toContainText(
    "[MAIN][Adecco Orb]"
  );
  await expect(page.getByText("通話が開始されました")).toBeVisible();
  await expect(page.getByText("お時間ありがとうございます。")).toBeVisible();

  await page.getByLabel("メッセージを送信").fill("募集背景を教えてください。");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.getByText("募集背景を教えてください。")).toBeVisible();

  await expect(page.getByText("履歴", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ボイス設定", { exact: true })).toHaveCount(0);
  await expect(page.getByText("モックツール", { exact: true })).toHaveCount(0);

  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toContain("agent_");
  expect(visibleText).not.toContain("agtbrch_");
  expect(visibleText.toLowerCase()).not.toContain("elevenlabs");
  expect(visibleText.toLowerCase()).not.toContain("convai");
});

test("start button cannot issue duplicate starts in mock mode", async ({ page }) => {
  await page.goto("/demo/adecco-roleplay?mock=1");
  const call = page.getByLabel("通話を開始");
  await call.click();
  await expect(page.getByText("通話が開始されました")).toBeVisible();
  await expect(page.getByLabel("通話を終了")).toBeVisible();
});

test("fake live mode is event-driven and supports chat, mute, and new conversation", async ({
  page,
}) => {
  await page.goto("/demo/adecco-roleplay?fakeLive=1");
  await expect(page.getByTestId("message-list").locator(".message-row")).toHaveCount(0);
  await expect(page.getByText("お時間ありがとうございます。今回は新しい派遣会社さん")).toHaveCount(0);

  await page.getByLabel("通話を開始").click();
  await expect(page.getByText("御社の進め方も含めて")).toBeVisible();

  const muteEvent = page.evaluate(
    () =>
      new Promise((resolve) => {
        window.addEventListener(
          "roleplay:fake-live-mute",
          (event) => resolve((event as CustomEvent).detail),
          { once: true }
        );
      })
  );
  await page.getByRole("button", { name: /ミュート/ }).click();
  expect(await muteEvent).toMatchObject({ muted: true });
  await expect(page.getByText("募集背景を確認したいです。")).toHaveCount(0);

  await page.getByLabel("メッセージを送信").fill("募集背景を教えてください。");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.getByText("募集背景を教えてください。")).toBeVisible();
  await expect(page.getByText("現行ベンダーの供給が安定せず")).toBeVisible();

  await page.getByLabel("通話を終了").click();
  await expect(page.getByRole("button", { name: /新しい会話/ })).toBeVisible();
  await page.getByRole("button", { name: /新しい会話/ }).click();
  await expect(page.getByTestId("message-list").locator(".message-row")).toHaveCount(0);

  await page.getByLabel("通話を開始").click();
  await expect(page.getByText("御社の進め方も含めて")).toBeVisible();
});
