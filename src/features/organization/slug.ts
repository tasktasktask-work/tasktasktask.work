/* ==========================================================================
   組織の slug

   URL に含まれる組織の識別子である（/o/acme/...）。
   画面から作る経路と pnpm org:create の両方がここを通る。

   分けて持つと、片方にだけ予約語が増えた日から、
   もう片方からは admin という slug が通る。

   仕様は docs/features/organization/index.html#make にある。
   ========================================================================== */

/**
 * 先頭と末尾はハイフンにできない。3文字から40文字。
 * organizations_slug_format と同じ形を、こちら側でも持つ。
 *
 * 二重に持つのは、データベースの制約が「入れさせない」ためのものであり、
 * 何が悪いのかを利用者に伝えるためのものではないからである。
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * URL の一階層目として使う可能性のある語。
 *
 * 取られてしまうと、後からその名前でページを増やせなくなる。
 * いまは /o/{slug} の下に組織があるので衝突しないが、
 * 短いURLへ移す判断をした日に、この一覧が無いと詰む。
 *
 * データベースの制約にはしない。
 * 語をひとつ足すたびに移行が積まれ、
 * そのうえ、すでに使われている語を後から予約語にできなくなる（既存行が違反する）。
 */
/*
 * o と me は3文字に満たないので、形の検査で先に落ちる。
 * それでも並べてあるのは、URL の一階層目として押さえてある語を
 * 一箇所で読めるようにするためである。
 */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'assets',
  'auth',
  'docs',
  'health',
  'help',
  'join',
  'login',
  'logout',
  'me',
  'new',
  'o',
  'public',
  'settings',
  'signup',
  'static',
  'status',
  'support',
  'www',
];

export type SlugProblem = 'invalid-slug' | 'reserved-slug';

export type SlugCheck =
  | { readonly ok: true; readonly slug: string }
  | { readonly ok: false; readonly reason: SlugProblem };

/** 入力欄の下に出す説明。文言を一箇所にまとめておく。 */
export const SLUG_HINT = '小文字の英数字とハイフン、3〜40文字。あとから変えられません。';

/**
 * 打ち込まれた値を slug として受け取れるか確かめる。
 *
 * 前後の空白を落とし、小文字に揃えてから見る。
 * 大文字で打った人を断る理由がない。保存する形は小文字だけである。
 */
export function checkSlug(raw: string): SlugCheck {
  const slug = raw.trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: 'invalid-slug' };
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return { ok: false, reason: 'reserved-slug' };
  }
  return { ok: true, slug };
}
