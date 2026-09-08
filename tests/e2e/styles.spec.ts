import { expect, test } from './fixtures.ts';

/*
 * 見た目が届いているか。
 *
 * ログイン画面は誰でも開けるので、種を蒔かなくても見られる。
 * 接続先を本番へ向けたときも、この一本だけは走る。
 */

test('ログイン画面に意匠が効いている', async ({ page }) => {
  await page.goto('/login');

  const card = page.locator('.auth-card');
  await expect(card).toBeVisible();

  const look = await card.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, padding: style.paddingTop };
  });

  // 素の HTML なら背景は透明で、余白も付かない
  expect(look.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(look.padding).not.toBe('0px');

  // 書体が読み込まれている。読み込めていなければ既定の書体に落ちる
  const font = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toContain('Zen Kaku Gothic New');
});
