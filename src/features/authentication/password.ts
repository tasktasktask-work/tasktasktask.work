import { hash, verify } from '@node-rs/argon2';

/*
 * パスワードの取り扱い。
 *
 * 文字種を強制しないのは、記号や数字を必須にすると
 * Password1! のような、規則を満たすだけの推測しやすい文字列に流れるためである。
 * 長さだけを条件にするほうが結果として強い。
 */

export const MIN_PASSWORD_LENGTH = 8;

/*
 * algorithm を指定していないのは、@node-rs/argon2 の既定が Argon2id だからである。
 * 明示したいところだが、Algorithm は ambient const enum なので
 * verbatimModuleSyntax のもとでは値として参照できない。
 * 既定が変わっていないことは、生成されたハッシュが $argon2id$ で始まることで確かめる。
 */
const options = {} as const;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  }
  return hash(plain, options);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    // 保存されている値が壊れている場合。認証は失敗として扱う。
    return false;
  }
}

/*
 * 存在しないアカウントに対しても、存在する場合と同じだけ時間をかける。
 *
 * 照合を省くと応答が明らかに速くなり、
 * 「このメールアドレスは登録されているか」を外から測れてしまう。
 */
const DUMMY_HASH = await hash('dummy-password-for-timing-equalisation', options);

export async function wasteTimeLikeVerifying(): Promise<void> {
  await verify(DUMMY_HASH, 'never-matches').catch(() => false);
}
