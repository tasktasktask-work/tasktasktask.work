import { canSeed, expect, test } from './fixtures.ts';

/*
 * スレッド詳細の、書く動線。
 *
 * ここに置いてあるのは、ブラウザの中でしか起きないものだけである。
 * 読み表示と入力欄の入れ替えは CSS（:has()）が決めるので、
 * 描いた HTML をいくら読んでも、どちらが見えているかは分からない。
 * 添付が押しボタンなしで送られることも、change と drop のイベントを
 * 実際に起こさないと現れない。
 *
 * 誰が書けるかの判定は tests/permission.test.ts と tests/thread.test.ts が持つ。
 */

test.describe('スレッド詳細で書く', () => {
  test.skip(!canSeed, '接続先を与えられているときは、種を蒔けない');

  test('見出しの編集でタイトルが入れ替わり、保存すると閉じて新しい題が出る', async ({
    page,
    sown,
  }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    const head = page.locator('.app-head');
    const heading = page.getByRole('heading', { name: '検索の設計' });
    await expect(heading).toBeVisible();

    const field = page.getByLabel('タイトル', { exact: true });
    await expect(field).toBeHidden();

    // 「本文編集済み」の印と紛れないよう、完全一致で拾う
    await head.getByText('編集', { exact: true }).click();

    // 入れ替わる。読み表示は消え、入力欄が出る
    await expect(field).toBeVisible();
    await expect(heading).toBeHidden();

    await field.fill('検索 API の設計');
    // 属性の欄にも「保存」がある。見出しの側だけを指す
    await head.getByRole('button', { name: '保存' }).click();

    // 保存できたら閉じて読みへ戻る
    await expect(page.getByText('保存しました')).toBeVisible();
    await expect(page.getByRole('heading', { name: '検索 API の設計' })).toBeVisible();
    await expect(field).toBeHidden();

    // タイトルだけを直したので、本文の印は付かない。
    // 本文の欄の注意書きにも同じ文字列があるので、印そのものを指す
    await expect(page.locator('.app-edited')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: '検索 API の設計' })).toBeVisible();
  });

  test('やめると、元のタイトルへ戻る', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    const head = page.locator('.app-head');
    await head.getByText('編集', { exact: true }).click();
    await page.getByLabel('タイトル', { exact: true }).fill('書きかけ');
    await head.getByRole('button', { name: 'やめる' }).click();

    await expect(page.getByRole('heading', { name: '検索の設計' })).toBeVisible();
    await expect(page.getByLabel('タイトル', { exact: true })).toBeHidden();
  });

  test('ファイルを選ぶだけで、押しボタンを押さずに添付が終わる', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    const zone = page.locator('.p-attach-drop');
    /*
     * 押しボタンは noscript の中にある。JavaScript が動いていれば出ない。
     * 完全一致で拾うのは、ファイルの欄の名前が「添付するファイル」で、
     * 部分一致だとそちらに当たるためである。
     */
    await expect(zone.getByRole('button', { name: '添付する', exact: true })).toHaveCount(0);

    await zone.getByLabel('添付するファイル').setInputFiles({
      name: '要件.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('前方一致だけで出す。', 'utf8'),
    });

    await expect(page.getByText('1件を添付しました')).toBeVisible();
    await expect(page.getByRole('link', { name: '要件.txt' })).toBeVisible();
  });

  test('落とすだけで添付が終わる', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    /*
     * 落とす操作は、ブラウザの外から作った DataTransfer を渡して起こす。
     * setInputFiles では drop の経路を通らない。
     */
    const data = await page.evaluateHandle(() => {
      const box = new DataTransfer();
      box.items.add(new File(['カーソル方式にする。'], '方式.txt', { type: 'text/plain' }));
      return box;
    });

    const zone = page.locator('.p-attach-drop .zone');
    await zone.dispatchEvent('dragover', { dataTransfer: data });
    await zone.dispatchEvent('drop', { dataTransfer: data });

    await expect(page.getByText('1件を添付しました')).toBeVisible();
    await expect(page.getByRole('link', { name: '方式.txt' })).toBeVisible();
  });
});
