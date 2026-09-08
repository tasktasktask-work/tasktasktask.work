import { canSeed, expect, test } from './fixtures.ts';

/*
 * 入るところ。
 *
 * マジックリンクの着地は、リクエストからURLを組むと本番だけ壊れる。
 * ホスト名を見ないためで、手元でサーバーを起こしても再現しない。
 * ここでは実際に踏んで、着いた先を見る。
 */

test.describe('マジックリンクで入る', () => {
  test.skip(!canSeed, '接続先を与えられているときは、種を蒔けない');

  test('リンクを踏むと組織の一覧に着く', async ({ page, sown, baseURL }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);

    /*
     * 行き先が、いま見ているホストのままであること。
     *
     * 0.0.0.0 は Linux では localhost に繋がってしまうので、
     * 開いたかどうかだけを見ると素通りする。ホスト名そのものを見る。
     */
    const here = new URL(page.url());
    const expected = new URL(baseURL ?? '');
    expect(here.host).toBe(expected.host);
    expect(here.pathname).toBe('/');
    await expect(page.getByRole('heading', { name: '組織' })).toBeVisible();
    await expect(page.getByText('株式会社アクメ')).toBeVisible();
  });

  test('同じリンクは二度使えない', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await expect(page.getByRole('heading', { name: '組織' })).toBeVisible();

    await page.context().clearCookies();
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await expect(page).toHaveURL(/magic=used/);
  });

  test('組織のカードに枠が付いている', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);

    /*
     * 資料だけの区画に規則を置いたまま画面から使うと、素の文字で並ぶ。
     * 型検査もビルドもテストも通り、崩れるのは本物の画面だけである。
     */
    const card = page.locator('.card').first();
    await expect(card).toBeVisible();

    const look = await card.evaluate((el) => {
      const style = getComputedStyle(el);
      return { padding: style.paddingTop, display: style.display };
    });
    expect(look.display).toBe('block');
    expect(look.padding).not.toBe('0px');
  });
});
