'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentScope } from '#features/organization/scope.ts';
import { projectPath } from '#features/project/path.ts';
import { resolveProject } from '#features/project/queries.ts';
import type { OrgScope } from '#lib/db.ts';
import { parseThreadNumber, threadPath } from './path.ts';
import {
  createThread,
  deleteThread,
  editThreadText,
  resolveThread,
  setAssignee,
  setBodyCheck,
  setParent,
  setPeriod,
  setProgress,
  setThreadArchived,
  type ThreadDetail,
  type ThreadProblem,
  threadType,
} from './queries.ts';

/* ==========================================================================
   スレッドの操作

   フォームから届くのは slug とプロジェクトキーとスレッド番号だけである。
   id はここで引き直す。
   フォームに書かれた id を信じると、他のプロジェクトのスレッドの id を
   差し込むだけで閲覧の判定を飛び越えられる。

   引き直しは resolveProject と resolveThread を通るので、
   見えないものはここで止まる。
   ========================================================================== */

export type ThreadActionState = { error?: string; notice?: string };

const PROBLEM: Record<ThreadProblem, string> = {
  forbidden: '操作する権限がありません',
  'not-found': 'そのスレッドは見つかりません',
  archived: 'アーカイブ済みのスレッドは変更できません',
  'not-archived': '先にアーカイブしてください',
  'project-archived': 'このプロジェクトはアーカイブされています',
  'invalid-title': 'タイトルを入力してください',
  'invalid-progress': '進捗率の値が種別に合いません',
  'invalid-period': '開始日と終了日は両方入れてください。終了日は開始日より後にします',
  'period-not-allowed': '期間を持てるのは課題だけです',
  'parent-not-found': 'その番号のスレッドは、このプロジェクトにありません',
  'parent-cycle': 'その親を選ぶと、親子が輪になります',
  'parent-archived': 'アーカイブ済みのスレッドは親にできません',
  'not-org-member': 'その人はこの組織のメンバーではありません',
  'no-such-check': 'そのチェックボックスは見つかりません',
};

const say = (reason: ThreadProblem): string => PROBLEM[reason] ?? '操作できませんでした';

const target = z.object({
  slug: z.string().min(1),
  key: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

/** slug とキーと番号から、スコープとスレッドを引き直す。 */
async function locate(
  slug: string,
  key: string,
  number: number,
): Promise<{ scope: OrgScope; thread: ThreadDetail } | null> {
  const found = await currentScope(slug);
  if (!found.ok) {
    return null;
  }
  const project = await resolveProject(found.scope, key);
  if (!project) {
    return null;
  }
  const thread = await resolveThread(found.scope, project.id, number);
  return thread ? { scope: found.scope, thread } : null;
}

/**
 * 画面を引き直させる。
 *
 * 一覧は更新順に並ぶので、詳細をいじると一覧の並びも変わる。
 * 両方を指しておかないと、戻ったときに古い並びが残る。
 */
function refresh(slug: string, key: string, number: number): void {
  revalidatePath(`/o/${slug}/p/${key}`);
  revalidatePath(`/o/${slug}/p/${key}/t/${number}`);
}

/* --------------------------------------------------------------------------
   立てる
   -------------------------------------------------------------------------- */

const createForm = z.object({
  slug: z.string().min(1),
  key: z.string().min(1),
  type: threadType,
  title: z.string().min(1, 'タイトルを入力してください'),
  body: z.string().optional(),
  parent: z.string().optional(),
  assignee: z.string().optional(),
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
});

/** 空欄は null にする。日付欄も担当者欄も、未入力は「無い」である。 */
const blankToNull = (value: string | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

export async function createThreadAction(
  _prev: ThreadActionState,
  form: FormData,
): Promise<ThreadActionState> {
  const parsed = createForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const input = parsed.data;

  const found = await currentScope(input.slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }
  const project = await resolveProject(found.scope, input.key);
  if (!project) {
    return { error: 'そのプロジェクトは見つかりません' };
  }

  const parentNumber = parseThreadNumber(input.parent ?? '');
  if (parentNumber === undefined) {
    return { error: '親は WEB-3 のような形か、番号だけで指定してください' };
  }

  const result = await createThread(found.scope, project.id, {
    type: input.type,
    title: input.title,
    body: input.body ?? '',
    parentNumber,
    assigneeUserId: blankToNull(input.assignee),
    startsOn: blankToNull(input.startsOn),
    endsOn: blankToNull(input.endsOn),
  });
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${input.slug}/p/${input.key}`);
  redirect(threadPath(input.slug, project.key, result.number));
}

/* --------------------------------------------------------------------------
   直す
   -------------------------------------------------------------------------- */

const textForm = target.extend({
  title: z.string().min(1, 'タイトルを入力してください'),
  body: z.string().optional(),
});

export async function editThreadTextAction(
  _prev: ThreadActionState,
  form: FormData,
): Promise<ThreadActionState> {
  const parsed = textForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const here = await locate(parsed.data.slug, parsed.data.key, parsed.data.number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await editThreadText(
    here.scope,
    here.thread.id,
    parsed.data.title,
    parsed.data.body ?? '',
  );
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(parsed.data.slug, parsed.data.key, parsed.data.number);
  return { notice: '保存しました' };
}

const progressForm = target.extend({ progress: z.coerce.number().int().min(0).max(100) });

export async function setProgressAction(
  _prev: ThreadActionState,
  form: FormData,
): Promise<ThreadActionState> {
  const parsed = progressForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: '進捗率は0から100の整数で入れてください' };
  }
  const here = await locate(parsed.data.slug, parsed.data.key, parsed.data.number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await setProgress(here.scope, here.thread.id, parsed.data.progress);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(parsed.data.slug, parsed.data.key, parsed.data.number);
  return { notice: '保存しました' };
}

const assigneeForm = target.extend({ assignee: z.string().optional() });

export async function setAssigneeAction(
  _prev: ThreadActionState,
  form: FormData,
): Promise<ThreadActionState> {
  const parsed = assigneeForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const here = await locate(parsed.data.slug, parsed.data.key, parsed.data.number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await setAssignee(
    here.scope,
    here.thread.id,
    blankToNull(parsed.data.assignee),
  );
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(parsed.data.slug, parsed.data.key, parsed.data.number);
  return { notice: '保存しました' };
}

const periodForm = target.extend({
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
});

export async function setPeriodAction(
  _prev: ThreadActionState,
  form: FormData,
): Promise<ThreadActionState> {
  const parsed = periodForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const here = await locate(parsed.data.slug, parsed.data.key, parsed.data.number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await setPeriod(here.scope, here.thread.id, {
    startsOn: blankToNull(parsed.data.startsOn),
    endsOn: blankToNull(parsed.data.endsOn),
  });
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(parsed.data.slug, parsed.data.key, parsed.data.number);
  return { notice: '保存しました' };
}

const parentForm = target.extend({ parent: z.string().optional() });

export async function setParentAction(
  _prev: ThreadActionState,
  form: FormData,
): Promise<ThreadActionState> {
  const parsed = parentForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const number = parseThreadNumber(parsed.data.parent ?? '');
  if (number === undefined) {
    return { error: '親は WEB-3 のような形か、番号だけで指定してください' };
  }

  const here = await locate(parsed.data.slug, parsed.data.key, parsed.data.number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await setParent(here.scope, here.thread.id, number);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(parsed.data.slug, parsed.data.key, parsed.data.number);
  return { notice: number === null ? '親を外しました' : '親を設定しました' };
}

/* --------------------------------------------------------------------------
   畳む、消す
   -------------------------------------------------------------------------- */

const archiveForm = target.extend({ archived: z.enum(['true', 'false']) });

export async function setThreadArchivedAction(
  _prev: ThreadActionState,
  form: FormData,
): Promise<ThreadActionState> {
  const parsed = archiveForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const here = await locate(parsed.data.slug, parsed.data.key, parsed.data.number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const archived = parsed.data.archived === 'true';
  const result = await setThreadArchived(here.scope, here.thread.id, archived);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(parsed.data.slug, parsed.data.key, parsed.data.number);
  return {
    notice: archived
      ? 'アーカイブしました。読み取り専用になります。'
      : 'アーカイブを解除しました。',
  };
}

export async function deleteThreadAction(
  _prev: ThreadActionState,
  form: FormData,
): Promise<ThreadActionState> {
  const parsed = target.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const here = await locate(parsed.data.slug, parsed.data.key, parsed.data.number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await deleteThread(here.scope, here.thread.id);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${parsed.data.slug}/p/${parsed.data.key}`);
  redirect(projectPath(parsed.data.slug, parsed.data.key));
}

/* --------------------------------------------------------------------------
   本文のチェックボックス
   -------------------------------------------------------------------------- */

const bodyCheck = target.extend({
  position: z.number().int().min(0),
  checked: z.boolean(),
});

export type BodyCheckInput = z.infer<typeof bodyCheck>;

/**
 * 本文の中のチェックボックスを入れる、あるいは外す。
 *
 * 本文の編集とは別の入口にしてある。
 * 編集の欄を開かせると、チェックを一つ入れるために本文全体が
 * 上書きの対象になる。押した瞬間に、その箱だけを差し替える。
 */
export async function setBodyCheckAction(input: BodyCheckInput): Promise<ThreadActionState> {
  const parsed = bodyCheck.safeParse(input);
  if (!parsed.success) {
    return { error: 'チェックの指定が不正です' };
  }
  const { slug, key, number, position, checked } = parsed.data;

  const here = await locate(slug, key, number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await setBodyCheck(here.scope, here.thread.id, position, checked);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(slug, key, number);
  return {};
}
