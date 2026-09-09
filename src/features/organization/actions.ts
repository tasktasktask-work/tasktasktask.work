'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentUser, setSessionCookie } from '#features/authentication/cookie.ts';
import { MIN_PASSWORD_LENGTH } from '#features/authentication/policy.ts';
import { acceptInvitation, inviteMember, revokeInvitation } from './invitations.ts';
import {
  changeMemberRole,
  createOrganization,
  memberRole,
  removeMember,
  renameOrganization,
} from './queries.ts';
import { currentScope } from './scope.ts';
import { completeSignup, startSignup } from './signup.ts';
import { SLUG_HINT } from './slug.ts';

/* ==========================================================================
   組織の操作

   どの操作も、まず slug からスコープを組み立て直す。
   フォームから届いた organization_id を信じない。
   信じると、他社の id を書いたフォームを投げるだけで通ってしまう。
   ========================================================================== */

export type OrgActionState = { error?: string; notice?: string };

const slugField = z.object({ slug: z.string().min(1) });

/* --------------------------------------------------------------------------
   メンバー
   -------------------------------------------------------------------------- */

const inviteForm = slugField.extend({
  email: z.string().min(1, 'メールアドレスを入力してください'),
  role: memberRole,
});

const INVITE_PROBLEM: Record<string, string> = {
  forbidden: '招待を送れるのは組織管理者だけです',
  'invalid-email': 'メールアドレスの形式が正しくありません',
  'already-member': 'その人はすでにこの組織のメンバーです',
  'already-invited': 'その相手には、まだ使われていない招待があります',
};

export async function inviteMemberAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = inviteForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const found = await currentScope(parsed.data.slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const result = await inviteMember(found.scope, parsed.data.email, parsed.data.role);
  if (!result.ok) {
    return { error: INVITE_PROBLEM[result.reason] ?? '招待を送れませんでした' };
  }

  revalidatePath(`/o/${parsed.data.slug}/members`);
  return { notice: `${parsed.data.email} に招待を送りました。48時間のあいだ有効です。` };
}

const revokeForm = slugField.extend({ invitationId: z.uuid() });

export async function revokeInvitationAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = revokeForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const found = await currentScope(parsed.data.slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const result = await revokeInvitation(found.scope, parsed.data.invitationId);
  if (!result.ok) {
    return { error: 'その招待は取り消せませんでした' };
  }

  revalidatePath(`/o/${parsed.data.slug}/members`);
  return { notice: '招待を取り消しました。届いているリンクは使えなくなります。' };
}

const roleForm = slugField.extend({ userId: z.uuid(), role: memberRole });

const MEMBER_PROBLEM: Record<string, string> = {
  forbidden: 'メンバーを操作できるのは組織管理者だけです',
  'not-member': 'その人はこの組織のメンバーではありません',
  'last-admin': '組織管理者がいなくなります。先に別の人を組織管理者にしてください。',
};

export async function changeRoleAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = roleForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const found = await currentScope(parsed.data.slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const result = await changeMemberRole(found.scope, parsed.data.userId, parsed.data.role);
  if (!result.ok) {
    return { error: MEMBER_PROBLEM[result.reason] ?? '役割を変えられませんでした' };
  }

  revalidatePath(`/o/${parsed.data.slug}/members`);
  return { notice: '役割を変えました' };
}

const removeForm = slugField.extend({ userId: z.uuid() });

export async function removeMemberAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = removeForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const found = await currentScope(parsed.data.slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const result = await removeMember(found.scope, parsed.data.userId);
  if (!result.ok) {
    return { error: MEMBER_PROBLEM[result.reason] ?? 'メンバーを外せませんでした' };
  }

  revalidatePath(`/o/${parsed.data.slug}/members`);
  return { notice: 'メンバーを外しました' };
}

/* --------------------------------------------------------------------------
   組織の設定
   -------------------------------------------------------------------------- */

const renameForm = slugField.extend({
  name: z.string().min(1, '組織名を入力してください'),
});

export async function renameOrganizationAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = renameForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const found = await currentScope(parsed.data.slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const result = await renameOrganization(found.scope, parsed.data.name);
  if (!result.ok) {
    return {
      error:
        result.reason === 'invalid-name'
          ? '組織名を入力してください'
          : '設定を変えられるのは組織管理者だけです',
    };
  }

  revalidatePath(`/o/${parsed.data.slug}`);
  return { notice: '組織名を変えました' };
}

/* --------------------------------------------------------------------------
   招待を受ける
   -------------------------------------------------------------------------- */

const acceptForm = z.object({
  token: z.string().min(1),
  displayName: z.string().optional(),
  password: z.string().optional(),
});

const ACCEPT_PROBLEM: Record<string, string> = {
  invalid: 'その招待リンクは使えません。招待した人に送り直しを頼んでください。',
  expired: '招待の有効期間が切れています。招待した人に送り直しを頼んでください。',
  revoked: 'その招待は取り消されています。',
  used: 'その招待はすでに使われています。ログインしてください。',
  'display-name-required': '表示名を入力してください',
  'password-too-short': `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`,
};

export async function acceptInvitationAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = acceptForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const h = await headers();
  const result = await acceptInvitation(
    parsed.data.token,
    { displayName: parsed.data.displayName, password: parsed.data.password },
    {
      userAgent: h.get('user-agent') ?? undefined,
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    },
  );

  if (!result.ok) {
    return { error: ACCEPT_PROBLEM[result.reason] ?? '招待を受け取れませんでした' };
  }

  /*
   * 招待リンクを開けたことが、そのアドレスの持ち主である証拠になっている。
   * 別のアカウントでログインしていても、招待された側に切り替える。
   */
  await setSessionCookie(result.session);

  // slug は招待の行から来る。利用者の入力ではない。
  redirect(`/o/${result.slug}` as Route);
}

/* --------------------------------------------------------------------------
   組織を作る

   入口は二つ、作る処理はひとつ。
   未ログインの人はアドレスの確認を通り、ログイン済みの人は通らない。
   -------------------------------------------------------------------------- */

/** 組織を作れなかった理由の文言。二つの入口で同じものを使う。 */
const CREATE_PROBLEM: Record<string, string> = {
  'invalid-name': '組織名を入力してください',
  'invalid-slug': `URL に使う名前の形が正しくありません。${SLUG_HINT}`,
  'reserved-slug': 'その名前は使えません。別の名前にしてください。',
  'slug-taken': 'その名前はすでに使われています。別の名前にしてください。',
  invalid: 'このリンクは使えません。もう一度受け取ってください。',
  expired: 'このリンクの有効期間が切れています。もう一度受け取ってください。',
  used: 'このリンクはすでに使われています。ログインしてください。',
  'display-name-required': '表示名を入力してください',
  'password-too-short': `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`,
};

const startForm = z.object({
  email: z.string().min(1, 'メールアドレスを入力してください'),
});

/**
 * 確認のリンクを送る。
 *
 * 送った、送らなかった、すでに登録がある。
 * どれでも同じ文言を返す。出し分けると、そのアドレスの状態を外から測れる。
 */
export async function startSignupAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = startForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  await startSignup(parsed.data.email);

  return {
    notice: `確認のリンクを ${parsed.data.email.trim()} へ送りました。48時間のあいだ有効です。`,
  };
}

const completeForm = z.object({
  token: z.string().min(1),
  organizationName: z.string().min(1, '組織名を入力してください'),
  slug: z.string().min(1, 'URL に使う名前を入力してください'),
  displayName: z.string().optional(),
  password: z.string().optional(),
});

/** リンクの先で組織を作る。作れたら、そのままログイン状態にする。 */
export async function completeSignupAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = completeForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const h = await headers();
  const result = await completeSignup(
    parsed.data.token,
    {
      organizationName: parsed.data.organizationName,
      slug: parsed.data.slug,
      displayName: parsed.data.displayName,
      password: parsed.data.password,
    },
    {
      userAgent: h.get('user-agent') ?? undefined,
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    },
  );

  if (!result.ok) {
    return { error: CREATE_PROBLEM[result.reason] ?? '組織を作れませんでした' };
  }

  // リンクを踏めたことが、そのアドレスの持ち主である証拠になっている。
  await setSessionCookie(result.session);

  // slug は作った行から来る。利用者の入力そのものではない。
  redirect(`/o/${result.slug}` as Route);
}

const createForm = z.object({
  organizationName: z.string().min(1, '組織名を入力してください'),
  slug: z.string().min(1, 'URL に使う名前を入力してください'),
});

/**
 * ログイン済みの人が組織を作る。
 *
 * 確認のメールを挟まない。
 * そのアドレスは、ログインできている時点で確認が済んでいる。
 */
export async function createOrganizationAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const parsed = createForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const user = await currentUser();
  if (!user) {
    return { error: 'ログインし直してください' };
  }

  const result = await createOrganization(user.userId, {
    name: parsed.data.organizationName,
    slug: parsed.data.slug,
  });

  if (!result.ok) {
    return { error: CREATE_PROBLEM[result.reason] ?? '組織を作れませんでした' };
  }

  redirect(`/o/${result.slug}` as Route);
}
