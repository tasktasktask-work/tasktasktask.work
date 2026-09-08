import { canSeed, expect, test } from './fixtures.ts';

/*
 * 属性の欄。
 *
 * フォームに action を渡すと、React は処理を始める前に reset() を呼ぶ。
 * 保存はできているのに、欄だけが元の値へ戻る。
 * DOM の挙動なので、サーバー側の応答をいくら見ても分からない。
 */

test.describe('属性を変える', () => {
  test.skip(!canSeed, '接続先を与えられているときは、種を蒔けない');

  test('担当者を変えると、欄がその値のまま残る', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    const assignee = page.getByLabel('担当者');
    await expect(assignee).toHaveValue(sown.asukaId);

    await assignee.selectOption(sown.ryoId);
    await page.getByRole('button', { name: '変更' }).click();

    await expect(page.getByText('保存しました')).toBeVisible();
    // ここが本題。押したあとに元へ戻らないこと
    await expect(assignee).toHaveValue(sown.ryoId);

    // 読み直しても同じであること。画面だけの話になっていないか
    await page.reload();
    await expect(page.getByLabel('担当者')).toHaveValue(sown.ryoId);
  });

  test('進捗率を変えると、欄がその値のまま残る', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    const progress = page.getByLabel('進捗率');
    await expect(progress).toHaveValue('40');

    await progress.fill('75');
    await page.getByRole('button', { name: '保存' }).first().click();

    await expect(progress).toHaveValue('75');
    await page.reload();
    await expect(page.getByLabel('進捗率')).toHaveValue('75');
  });

  test('欄をいじると、保存の知らせは消える', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    const assignee = page.getByLabel('担当者');
    await assignee.selectOption(sown.ryoId);
    await page.getByRole('button', { name: '変更' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();

    // 保存していない値の横に「保存しました」を残さない
    await assignee.selectOption('');
    await expect(page.getByText('保存しました')).toHaveCount(0);
  });
});
