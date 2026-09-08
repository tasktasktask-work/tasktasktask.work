import { canSeed, expect, test } from './fixtures.ts';

/*
 * コメントを投稿する。
 *
 * 添付の欄は、何も選ばなくても送られてくる。
 * そのとき届く形はブラウザ側の符号化で決まるので、
 * フォームを手で組む試験では現れない。実際に押すしかない。
 */

test.describe('コメントの投稿', () => {
  test.skip(!canSeed, '接続先を与えられているときは、種を蒔けない');

  test('添付を付けずに投稿できる', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    await page.getByPlaceholder('コメントを書く').fill('本文だけのコメントである。');
    await page.getByRole('button', { name: '投稿する' }).click();

    await expect(page.getByText('本文だけのコメントである。')).toBeVisible();
    // 空のファイル欄を断ると、ここに知らせが出る
    await expect(page.getByText('中身が空')).toHaveCount(0);
  });

  test('添付を一つ付けて投稿でき、名前が保たれる', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    /*
     * ファイルの欄は二つある。スレッドの本文に付けるものと、コメントに付けるもの。
     * 投稿の欄の側だけを指す。
     */
    const compose = page.locator('.app-compose');
    await compose.getByPlaceholder('コメントを書く').fill('資料を付ける。');
    await compose.getByLabel('添付するファイル').setInputFiles({
      name: '設計メモ.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('どう組むかを決める。', 'utf8'),
    });
    await compose.getByRole('button', { name: '投稿する' }).click();

    await expect(page.getByText('資料を付ける。')).toBeVisible();
    // 名前が blob に化けていないこと
    await expect(page.getByRole('link', { name: '設計メモ.txt' })).toBeVisible();
  });
});
