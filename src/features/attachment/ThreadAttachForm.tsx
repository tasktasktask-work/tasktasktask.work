'use client';

import { useActionState } from 'react';
import { AttachmentPicker } from './AttachmentPicker.tsx';
import { type AttachmentActionState, attachToThreadAction } from './actions.ts';
import { BATCH_MAX, FILE_MAX, formatBytes } from './limits.ts';

/* ==========================================================================
   本文に添付を足す欄

   スレッドを立てる画面には置いていない。
   立てる処理は親子と期間とタグを一つの取引で検査するので、
   そこへ 30MB の書き込みを足すと、失敗したときに
   ファイルの選び直しまで巻き込むことになる。
   ========================================================================== */

const empty: AttachmentActionState = {};

export function ThreadAttachForm({
  slug,
  projectKey,
  number,
}: {
  slug: string;
  projectKey: string;
  number: number;
}) {
  const [state, action, sending] = useActionState(attachToThreadAction, empty);

  return (
    <form className="app-form" action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="number" value={number} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}

      <div className="line">
        <AttachmentPicker
          hint={`1ファイル ${formatBytes(FILE_MAX)}、一度に合計 ${formatBytes(BATCH_MAX)} まで。形式は問いません`}
        />
        <span style={{ flex: 1 }} />
        <button className="app-btn ghost" type="submit" disabled={sending}>
          {sending ? '送っています…' : '添付する'}
        </button>
      </div>
    </form>
  );
}
