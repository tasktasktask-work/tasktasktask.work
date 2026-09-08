'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentScope } from '#features/organization/scope.ts';
import { resolveProject } from '#features/project/queries.ts';
import { resolveThread } from '#features/thread/queries.ts';
import type { OrgScope } from '#lib/db.ts';
import { describeProblem, readIncoming } from './incoming.ts';
import { type AttachmentProblem, attachToThread, deleteAttachment } from './queries.ts';
import { prepareAttachments } from './store.ts';

/* ==========================================================================
   添付の操作

   コメントの操作と同じ構えである。
   フォームから届くのは slug とプロジェクトキーとスレッド番号だけで、
   スレッドの id はここで引き直す。

   例外は消すときで、こちらは添付の id を受け取る。
   一つのスレッドに何枚も並ぶものを番号で数え直させる意味がない。
   受け取った id は SQL の側で「見えていて、かつ消せる」ことを確かめる。
   ========================================================================== */

export type AttachmentActionState = {
  error?: string;
  notice?: string;
  /** 二度押しの途中にある添付の id */
  confirming?: string;
};

const PROBLEM: Record<AttachmentProblem, string> = {
  forbidden: '操作する権限がありません',
  'not-found': 'そのスレッドは見つかりません',
  archived: 'アーカイブ済みのスレッドには付けられません',
  'project-archived': 'このプロジェクトはアーカイブされています',
  'nothing-chosen': 'ファイルが選ばれていません',
};

const target = z.object({
  slug: z.string().min(1),
  key: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

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

function refresh(slug: string, key: string, number: number): void {
  revalidatePath(`/o/${slug}/p/${key}/t/${number}`);
}

/* --------------------------------------------------------------------------
   付ける
   -------------------------------------------------------------------------- */

export async function attachToThreadAction(
  _prev: AttachmentActionState,
  form: FormData,
): Promise<AttachmentActionState> {
  const parsed = target.safeParse({
    slug: form.get('slug'),
    key: form.get('key'),
    number: form.get('number'),
  });
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, key, number } = parsed.data;

  const incoming = await readIncoming(form);
  if (!incoming.ok) {
    return { error: describeProblem(incoming.reason, incoming.filename) };
  }

  const here = await locate(slug, key, number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  // 作り直しは取引の外で行う。10MB を読み直して書き出すのに数秒かかる
  const prepared = await prepareAttachments(here.scope.organizationId, incoming.files);
  if (!prepared.ok) {
    return { error: describeProblem(prepared.reason, prepared.filename) };
  }

  const result = await attachToThread(here.scope, here.threadId, prepared.prepared);
  if (!result.ok) {
    return { error: PROBLEM[result.reason] };
  }

  refresh(slug, key, number);
  return { notice: `${prepared.prepared.length}件を添付しました` };
}

/* --------------------------------------------------------------------------
   消す
   -------------------------------------------------------------------------- */

const dropInput = target.extend({
  attachmentId: z.uuid(),
  confirm: z.string().optional(),
});

/**
 * 添付を消す。実体も消えるので取り消せない。
 *
 * 一度目は確かめるだけで、二度目に消える。
 * 取り消せない操作の見せ方は、タグを消すときと揃えてある。
 */
export async function deleteAttachmentAction(
  _prev: AttachmentActionState,
  form: FormData,
): Promise<AttachmentActionState> {
  const parsed = dropInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: '添付の指定が正しくありません' };
  }
  const { slug, key, number, attachmentId, confirm } = parsed.data;

  if (confirm !== '1') {
    return {
      confirming: attachmentId,
      notice: 'ファイルの実体ごと消えます。もう一度押すと消えます',
    };
  }

  const here = await locate(slug, key, number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await deleteAttachment(here.scope, attachmentId);
  if (!result.ok) {
    return { error: PROBLEM[result.reason] };
  }

  refresh(slug, key, number);
  return { notice: '添付を消しました' };
}
