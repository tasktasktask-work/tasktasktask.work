import { canSeed, expect, test } from './fixtures.ts';

/*
 * スレッドを立てる。
 *
 * ここに置いてあるのは、ブラウザの中でしか起きないものだけである。
 * 一覧の欄は、立てても画面が移動しない。移動しないことは、
 * 描かれた HTML を読んでも確かめられない。
 * 子スレッドの欄は、ラジオを押すまでタイトル欄が出ない。
 * 出し入れを決めるのは CSS（:has()）なので、こちらも同じである。
 *
 * 誰が立てられるかの判定は tests/thread.test.ts が持つ。
 */

test.describe('スレッドを立てる', () => {
  test.skip(!canSeed, '接続先を与えられているときは、種を蒔けない');

  test('一覧で立てると、画面は変わらずに番号が出る', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}`);

    const title = page.getByLabel('タイトル', { exact: true });
    await page.getByLabel('種別', { exact: true }).selectOption('giron');
    await title.fill('全文検索をどこまでやるか');
    await page.getByRole('button', { name: '立てる' }).click();

    // 立てた番号が知らせに出る。移動しないので、一覧の見出しはそのまま
    await expect(page.getByText('を立てました')).toBeVisible();
    await expect(page.getByRole('heading', { name: '検索基盤の刷新' })).toBeVisible();

    // タイトルだけ空へ戻り、種別は選んだまま残る
    await expect(title).toHaveValue('');
    await expect(page.getByLabel('種別', { exact: true })).toHaveValue('giron');

    // 立てた行が一覧に出ている
    await expect(page.getByRole('link', { name: '全文検索をどこまでやるか' })).toBeVisible();

    // 知らせのリンクから詳細へ行ける
    await page.locator('.app-new .told a').click();
    await expect(page.getByRole('heading', { name: '全文検索をどこまでやるか' })).toBeVisible();
  });

  test('詳細で種別を押すとタイトル欄が出て、立てると子に並ぶ', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    const title = page.getByLabel('子スレッドのタイトル');
    await expect(title).toBeHidden();

    // 三語のうち「議論」を押す。押した語が種別になる
    await page.locator('.p-child-new').getByText('議論', { exact: true }).click();
    await expect(title).toBeVisible();

    await title.fill('正規化の方針をどこまで揃えるか');
    await page.locator('.p-child-new').getByRole('button', { name: '立てる' }).click();

    // すぐ上の子スレッドの一覧に行が増える
    const child = page
      .locator('.p-child')
      .filter({ hasText: '正規化の方針をどこまで揃えるか' });
    await expect(child).toBeVisible();
    await expect(child.locator('.p-type')).toHaveText('議論');

    // 押した語は選ばれたまま、タイトルだけ空へ戻る
    await expect(title).toHaveValue('');
    await expect(title).toBeVisible();
  });
});
