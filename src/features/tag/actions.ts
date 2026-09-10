'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentScope } from '#features/organization/scope.ts';
import { resolveProject } from '#features/project/queries.ts';
import { threadPath } from '#features/thread/path.ts';
import { resolveThread } from '#features/thread/queries.ts';
import type { OrgScope } from '#lib/db.ts';
import { tagsPath } from './path.ts';
import {
  attachTagByName,
  countTagUsage,
  createTag,
  deleteTag,
  detachTag,
  setThreadTags,
  type TagProblem,
  updateTag,
} from './queries.ts';

/* ==========================================================================
   タグの操作

   フォームから届くのは slug と、スレッドならプロジェクトキーと番号だけである。
   スレッドの id はここで引き直す。書かれた id を信じると、
   他のプロジェクトのスレッドを差し込むだけで閲覧の判定を越えられる。

   タグの id はフォームから受け取るが、すべての問い合わせが
   organization_id で縛ってあるので、他組織の id は空振りする。
   ========================================================================== */

export type TagActionState = {
  error?: string;
  notice?: string;
  /** 消す押しボタンが二度目を待っている。 */
  confirming?: boolean;
  /** 打たれた名前のタグが無かった。管理画面への案内を出す合図。 */
  missing?: boolean;
};

const PROBLEM: Record<TagProblem, string> = {
  frozen: 'この組織は凍結されています。支払いの手続きが済むまで変更できません',
  'not-found': 'そのタグは見つかりません',
  'invalid-name': 'タグの名前は1文字以上40文字以内で入れてください',
  'invalid-color': 'その色は選べません',
  'duplicate-name': '同じ名前のタグが既にあります',
  'no-such-tag': 'そのタグはありません',
  'thread-not-found': 'そのスレッドは変更できません',
};

const say = (reason: TagProblem): string => PROBLEM[reason] ?? '操作できませんでした';

/* --------------------------------------------------------------------------
   管理画面
   -------------------------------------------------------------------------- */

const tagForm = z.object({
  slug: z.string().min(1),
  name: z.string(),
  color: z.string(),
});

export async function createTagAction(
  _prev: TagActionState,
  form: FormData,
): Promise<TagActionState> {
  const parsed = tagForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, name, color } = parsed.data;

  const found = await currentScope(slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const result = await createTag(found.scope, name, color);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(tagsPath(slug));
  return { notice: `${name.trim()} を作りました` };
}

export async function updateTagAction(
  _prev: TagActionState,
  form: FormData,
): Promise<TagActionState> {
  const parsed = tagForm.extend({ tagId: z.uuid() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, tagId, name, color } = parsed.data;

  const found = await currentScope(slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const result = await updateTag(found.scope, tagId, name, color);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(tagsPath(slug));
  return { notice: '保存しました' };
}

/**
 * 消す。一度目は何件から外れるかを返すだけで、二度目に実際に消す。
 *
 * 結びごと消すので取り消しが効かない。確認の窓を出す案もあったが、
 * 窓は押し慣れると読まれなくなる。押しボタンの文言が変わるだけなら、
 * 押した手が「変わった」ことに気づく。
 */
export async function deleteTagAction(
  _prev: TagActionState,
  form: FormData,
): Promise<TagActionState> {
  const parsed = z
    .object({ slug: z.string().min(1), tagId: z.uuid(), confirm: z.string().optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, tagId, confirm } = parsed.data;

  const found = await currentScope(slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  if (confirm !== '1') {
    const usage = await countTagUsage(found.scope, tagId);
    return {
      confirming: true,
      notice:
        usage === 0
          ? 'どのスレッドにも付いていません。もう一度押すと消えます'
          : `${usage}件のスレッドから外れます。もう一度押すと消えます`,
    };
  }

  const result = await deleteTag(found.scope, tagId);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(tagsPath(slug));
  return { notice: '消しました' };
}

/* --------------------------------------------------------------------------
   スレッドへの付け外し
   -------------------------------------------------------------------------- */

const target = z.object({
  slug: z.string().min(1),
  key: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

/** slug とキーと番号から、スコープとスレッドの id を引き直す。 */
async function locate(
  slug: string,
  key: string,
  number: number,
): Promise<{ scope: OrgScope; threadId: string } | null> {
  const found = await currentScope(slug);
  if (!found.ok) {
    return null;
  }
  const project = await resolveProject(found.scope, key);
  if (!project) {
    return null;
  }
  const thread = await resolveThread(found.scope, project.id, number);
  return thread ? { scope: found.scope, threadId: thread.id } : null;
}

export async function attachTagAction(
  _prev: TagActionState,
  form: FormData,
): Promise<TagActionState> {
  const parsed = target.extend({ name: z.string() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, key, number, name } = parsed.data;

  const found = await locate(slug, key, number);
  if (!found) {
    return { error: '操作する権限がありません' };
  }

  const result = await attachTagByName(found.scope, found.threadId, name);
  if (!result.ok) {
    // 無い名前を打たれたときだけ、管理画面への案内を添えたい。
    return result.reason === 'no-such-tag'
      ? { error: `${name.trim()} というタグはありません`, missing: true }
      : { error: say(result.reason) };
  }

  revalidatePath(threadPath(slug, key, number));
  return {};
}

export async function detachTagAction(
  _prev: TagActionState,
  form: FormData,
): Promise<TagActionState> {
  const parsed = target.extend({ tagId: z.uuid() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, key, number, tagId } = parsed.data;

  const found = await locate(slug, key, number);
  if (!found) {
    return { error: '操作する権限がありません' };
  }

  const result = await detachTag(found.scope, found.threadId, tagId);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(threadPath(slug, key, number));
  return {};
}

/**
 * チェックボックスの一覧から、付いているタグを丸ごと入れ替える。
 *
 * getAll を使うのは、同じ名前の欄が並ぶためである。
 * Object.fromEntries は最後の一つしか残さないので、
 * 三つ選んでも一つしか届かない。
 */
export async function setThreadTagsAction(
  _prev: TagActionState,
  form: FormData,
): Promise<TagActionState> {
  const parsed = target.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, key, number } = parsed.data;

  const ids = z.array(z.uuid()).safeParse(form.getAll('tags').map(String));
  if (!ids.success) {
    return { error: 'タグの指定が正しくありません' };
  }

  const found = await locate(slug, key, number);
  if (!found) {
    return { error: '操作する権限がありません' };
  }

  const result = await setThreadTags(found.scope, found.threadId, ids.data);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(threadPath(slug, key, number));
  return {};
}
