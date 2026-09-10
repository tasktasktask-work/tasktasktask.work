import { canSeed, demote, expect, freeze, test } from './fixtures.ts';

/*
 * 凍結。
 *
 * 判定の網は tests/billing.test.ts が持っている。
 * ここで確かめるのは、ブラウザの中でしか分からないことだけである。
 *
 * 帯が出ているか、書き込みの入口が消えているか、
 * そして役割によって帯の中身が変わるか。
 * 「押せない押しボタンを見せない」は、描画しないと確かめられない。
 */

test.describe('凍結', () => {
  test.skip(!canSeed, '接続先を与えられているときは、種を蒔けない');

  test('凍結すると帯が出て、書き込みの入口が消える', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);

    // 凍る前は、作る道がある
    await page.goto(`/o/${sown.tag}`);
    await expect(page.getByText('新しいプロジェクト')).toBeVisible();

    await freeze(sown.organizationId);
    await page.goto(`/o/${sown.tag}`);

    await expect(page.getByText('この組織は凍結されています。')).toBeVisible();
    await expect(page.getByText('新しいプロジェクト')).toHaveCount(0);

    // 読み取りは残る。プロジェクトは並んだままである
    await expect(page.getByText('検索基盤の刷新').first()).toBeVisible();
  });

  test('凍結中でもスレッドは読めるが、コメントは書けない', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await freeze(sown.organizationId);

    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}/t/${sown.threadNumber}`);

    await expect(page.getByRole('heading', { name: '検索の設計' })).toBeVisible();
    await expect(page.getByText('どう組むかを決める。')).toBeVisible();

    await expect(page.getByRole('button', { name: '投稿する' })).toHaveCount(0);
    await expect(
      page.getByText('組織が凍結されているので、新しいコメントは書けません。', {
        exact: false,
      }),
    ).toBeVisible();
  });

  test('凍結中はスレッドを立てる道が消える', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await freeze(sown.organizationId);

    await page.goto(`/o/${sown.tag}/p/${sown.projectKey}`);
    // 立てる欄は無効にせず、欄ごと出さない
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '立てる' })).toHaveCount(0);
    // 一覧そのものは読める
    await expect(page.getByText('検索の設計')).toBeVisible();
  });

  test('組織管理者の帯からは、支払いへ進める', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await freeze(sown.organizationId);
    await page.goto(`/o/${sown.tag}`);

    await page.getByRole('link', { name: '支払いの手続きへ' }).click();
    await expect(page.getByRole('heading', { name: '支払いと請求' })).toBeVisible();
    await expect(page.getByText('凍結', { exact: true })).toBeVisible();
    await expect(page.getByText('支払い方法が未登録です')).toBeVisible();
  });

  test('メンバーの帯には押しボタンが無い', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await demote(sown.organizationId, sown.asukaId);
    await freeze(sown.organizationId);

    await page.goto(`/o/${sown.tag}`);
    await expect(page.getByText('この組織は凍結されています。')).toBeVisible();
    await expect(page.getByText('組織管理者にご連絡ください。')).toBeVisible();
    await expect(page.getByRole('link', { name: '支払いの手続きへ' })).toHaveCount(0);

    // 左帯にも支払いは出ない
    await expect(page.getByRole('link', { name: '支払い', exact: true })).toHaveCount(0);
  });

  test('支払い方法を登録すると、その場で書けるようになる', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await freeze(sown.organizationId);

    await page.goto(`/o/${sown.tag}/billing`);
    await expect(page.getByText('支払い方法が未登録です')).toBeVisible();

    // BILLING_MODE=fake なので、決済代行の画面を挟まずに戻ってくる
    await page.getByRole('button', { name: '支払い方法を登録して再開する' }).click();
    await expect(page.getByText('支払い方法を登録しました。')).toBeVisible();

    // 帯が消え、作る道が戻る
    await page.goto(`/o/${sown.tag}`);
    await expect(page.getByText('この組織は凍結されています。')).toHaveCount(0);
    await expect(page.getByText('新しいプロジェクト')).toBeVisible();
  });

  test('おためし期間中は、請求の予定だけが出る', async ({ page, sown }) => {
    await page.goto(`/auth/magic?token=${sown.magicToken}`);
    await page.goto(`/o/${sown.tag}/billing`);

    await expect(page.getByText('おためし中')).toBeVisible();
    await expect(page.getByText('請求の記録はまだありません')).toBeVisible();
    await expect(page.getByText('$1.00 / 人 / 月（税込）')).toBeVisible();
  });
});
