'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentScope } from '#features/organization/scope.ts';
import type { OrgScope } from '#lib/db.ts';
import { projectPath } from './path.ts';
import {
  addProjectMember,
  changeVisibility,
  createProject,
  deleteProject,
  type ProjectDetail,
  type ProjectProblem,
  projectVisibility,
  removeProjectMember,
  renameProject,
  resolveProject,
  setArchived,
} from './queries.ts';

/* ==========================================================================
   プロジェクトの操作

   フォームから届くのは slug とプロジェクトキーだけである。
   プロジェクトの id はここで引き直す。
   フォームに書かれた id を信じると、他のプロジェクトの id を差し込むだけで
   閲覧の判定を飛び越えられる。

   引き直しは resolveProject を通るので、見えないプロジェクトはここで止まる。
   ========================================================================== */

export type ProjectActionState = { error?: string; notice?: string };

const PROBLEM: Record<ProjectProblem, string> = {
  forbidden: '操作する権限がありません',
  'not-found': 'そのプロジェクトは見つかりません',
  'not-archived': '先にアーカイブしてください',
  'invalid-key': 'キーは半角の英大文字と数字で、2文字から10文字にしてください',
  'duplicate-key': 'そのキーは、この組織ですでに使われています',
  'invalid-name': 'プロジェクト名を入力してください',
  'not-org-member': 'その人はこの組織のメンバーではありません',
  'already-member': 'その人はすでにこのプロジェクトのメンバーです',
  'not-member': 'その人はこのプロジェクトのメンバーではありません',
};

const say = (reason: ProjectProblem): string => PROBLEM[reason] ?? '操作できませんでした';

const target = z.object({ slug: z.string().min(1), key: z.string().min(1) });

/**
 * slug とキーから、スコープとプロジェクトを引き直す。
 * どちらかが取れなければ、そこで終わる。
 */
async function locate(
  slug: string,
  key: string,
): Promise<{ scope: OrgScope; project: ProjectDetail } | null> {
  const found = await currentScope(slug);
  if (!found.ok) {
    return null;
  }
  const project = await resolveProject(found.scope, key);
  return project ? { scope: found.scope, project } : null;
}

/* --------------------------------------------------------------------------
   作る
   -------------------------------------------------------------------------- */

const createForm = z.object({
  slug: z.string().min(1),
  key: z.string().min(1, 'キーを入力してください'),
  name: z.string().min(1, 'プロジェクト名を入力してください'),
  description: z.string().optional(),
  visibility: projectVisibility,
});

export async function createProjectAction(
  _prev: ProjectActionState,
  form: FormData,
): Promise<ProjectActionState> {
  const parsed = createForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const found = await currentScope(parsed.data.slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const result = await createProject(found.scope, {
    key: parsed.data.key,
    name: parsed.data.name,
    description: parsed.data.description ?? '',
    visibility: parsed.data.visibility,
  });
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${parsed.data.slug}`);
  redirect(projectPath(parsed.data.slug, result.key));
}

/* --------------------------------------------------------------------------
   設定
   -------------------------------------------------------------------------- */

const renameForm = target.extend({
  name: z.string().min(1, 'プロジェクト名を入力してください'),
  description: z.string().optional(),
});

export async function renameProjectAction(
  _prev: ProjectActionState,
  form: FormData,
): Promise<ProjectActionState> {
  const parsed = renameForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const here = await locate(parsed.data.slug, parsed.data.key);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await renameProject(
    here.scope,
    here.project.id,
    parsed.data.name,
    parsed.data.description ?? '',
  );
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${parsed.data.slug}`);
  return { notice: '保存しました' };
}

const visibilityForm = target.extend({ visibility: projectVisibility });

export async function changeVisibilityAction(
  _prev: ProjectActionState,
  form: FormData,
): Promise<ProjectActionState> {
  const parsed = visibilityForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const here = await locate(parsed.data.slug, parsed.data.key);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await changeVisibility(here.scope, here.project.id, parsed.data.visibility);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${parsed.data.slug}`);
  return {
    notice:
      parsed.data.visibility === 'private'
        ? 'このプロジェクトは非公開になりました。メンバーと組織管理者だけが見られます。'
        : 'このプロジェクトは公開になりました。組織のメンバー全員が見られます。',
  };
}

const archiveForm = target.extend({ archived: z.enum(['true', 'false']) });

export async function setArchivedAction(
  _prev: ProjectActionState,
  form: FormData,
): Promise<ProjectActionState> {
  const parsed = archiveForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const here = await locate(parsed.data.slug, parsed.data.key);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const archived = parsed.data.archived === 'true';
  const result = await setArchived(here.scope, here.project.id, archived);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${parsed.data.slug}`);
  return {
    notice: archived
      ? 'アーカイブしました。中のスレッドは読み取り専用になります。'
      : 'アーカイブを解除しました。',
  };
}

export async function deleteProjectAction(
  _prev: ProjectActionState,
  form: FormData,
): Promise<ProjectActionState> {
  const parsed = target.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const here = await locate(parsed.data.slug, parsed.data.key);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await deleteProject(here.scope, here.project.id);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${parsed.data.slug}`);
  redirect(`/o/${parsed.data.slug}` as Route);
}

/* --------------------------------------------------------------------------
   メンバー
   -------------------------------------------------------------------------- */

const addMemberForm = target.extend({
  userId: z.uuid(),
  isAdmin: z.enum(['true', 'false']).default('false'),
});

export async function addProjectMemberAction(
  _prev: ProjectActionState,
  form: FormData,
): Promise<ProjectActionState> {
  const parsed = addMemberForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const here = await locate(parsed.data.slug, parsed.data.key);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await addProjectMember(
    here.scope,
    here.project.id,
    parsed.data.userId,
    parsed.data.isAdmin === 'true',
  );
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${parsed.data.slug}/p/${parsed.data.key}/members`);
  return { notice: 'メンバーを追加しました' };
}

const removeMemberForm = target.extend({ userId: z.uuid() });

export async function removeProjectMemberAction(
  _prev: ProjectActionState,
  form: FormData,
): Promise<ProjectActionState> {
  const parsed = removeMemberForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const here = await locate(parsed.data.slug, parsed.data.key);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await removeProjectMember(here.scope, here.project.id, parsed.data.userId);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  revalidatePath(`/o/${parsed.data.slug}/p/${parsed.data.key}/members`);
  return { notice: 'メンバーを外しました' };
}
