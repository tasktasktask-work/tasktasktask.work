import { canSeed, expect, test } from './fixtures.ts';

/*
 * 組織を自分で作る。
 *
 * ここに置くのは、ブラウザの中でしか起きないものだけである。
 * 作れる作れないの判定は tests/signup.test.ts が持っている。
 *
 * 画面の側にしか無いのは三つ。
 * 送ったあとにカードが入れ替わること、断られたときに打った値が残ること、
 * 作り終えた人がその組織の中に着いていること。
 */

test.describe('組織を作る', () => {
  test.skip(!canSeed, '接続先を与えられているときは、種を蒔けない');

  test('アドレスを送ると、カードが知らせに入れ替わる', async ({ page }) => {
    await page.goto('/signup');

    await page.getByLabel('メールアドレス').fill('taro@example.com');
    await page.getByRole('button', { name: '確認のリンクを受け取る' }).click();

    await expect(page.getByText('確認のリンクを taro@example.com へ送りました')).toBeVisible();
    // 送ったあとの画面に、もう一度押せる欄は残さない
    await expect(page.getByRole('button', { name: '確認のリンクを受け取る' })).toHaveCount(0);
  });

  test('リンクの先で組織を作ると、その組織の中に着く', async ({ page, sown }) => {
    await page.goto(`/signup?token=${sown.signupToken}`);
    await expect(page.getByLabel('メールアドレス')).toHaveValue(sown.signupEmail);

    const slug = `${sown.tag}-co`;
    await page.getByLabel('組織名').fill('合同会社ベータ');
    await page.getByLabel('URL に使う名前').fill(slug);
    await page.getByLabel('表示名').fill('木村 直');
    await page.getByLabel('パスワード', { exact: false }).fill('correct horse battery');
    await page.getByRole('button', { name: '組織を作る' }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
    // 同じ名前の見出しが左帯にもある。本文の側を指す
    await expect(
      page.locator('.app-main').getByRole('heading', { name: 'プロジェクト' }),
    ).toBeVisible();

    // 作った人は組織管理者なので、設定へ入れる
    await page.goto(`/o/${slug}/settings`);
    await expect(page.getByRole('heading', { name: '組織の設定' })).toBeVisible();
  });

  test('slug が埋まっていても、打った組織名は残る', async ({ page, sown }) => {
    await page.goto(`/signup?token=${sown.signupToken}`);

    /*
     * action を渡したフォームは、React が送信のたびに元の値へ戻す。
     * 戻ると、名前を選び損ねただけの人が全部打ち直すことになる。
     * これはブラウザの中でしか起きない（2026-09-08 に同じ形で踏んだ）。
     */
    await page.getByLabel('組織名').fill('合同会社ベータ');
    await page.getByLabel('URL に使う名前').fill(sown.tag);
    await page.getByLabel('表示名').fill('木村 直');
    await page.getByLabel('パスワード', { exact: false }).fill('correct horse battery');
    await page.getByRole('button', { name: '組織を作る' }).click();

    await expect(page.getByText('すでに使われています')).toBeVisible();
    await expect(page.getByLabel('組織名')).toHaveValue('合同会社ベータ');
    await expect(page.getByLabel('URL に使う名前')).toHaveValue(sown.tag);
  });

  test('ログイン済みなら、確認を挟まずに作れる', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.getByRole('link', { name: '組織を作る' }).click();

    await expect(page).toHaveURL(/\/signup$/);
    // 確認のメールを求める欄は出ない
    await expect(page.getByRole('button', { name: '確認のリンクを受け取る' })).toHaveCount(0);

    const slug = `${sown.tag}-two`;
    await page.getByLabel('組織名').fill('鳥森デザイン');
    await page.getByLabel('URL に使う名前').fill(slug);
    await page.getByRole('button', { name: '組織を作る' }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
  });

  test('ログイン画面から入口へ行ける', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: '組織を新しく作る' }).click();

    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('button', { name: '確認のリンクを受け取る' })).toBeVisible();
  });
});
