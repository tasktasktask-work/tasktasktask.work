import { hash, verify } from '@node-rs/argon2';
import { MIN_PASSWORD_LENGTH } from './policy.ts';

/*
 * パスワードの取り扱い。
 *
 * 決まりごと（最短の長さ）は policy.ts にある。
 * この拡張はブラウザ側の束に入れられないので、
 * 画面から参照したい値をここに置かない。
 */

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
