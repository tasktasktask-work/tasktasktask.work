'use client';

import { useActionState } from 'react';
import { type AttachmentActionState, deleteAttachmentAction } from './actions.ts';
import { formatBytes } from './limits.ts';
import { attachmentPath } from './path.ts';
import type { AttachmentRow } from './queries.ts';

/* ==========================================================================
   添付の並び

   付けた順に出す。新しいものを上にすると、本文やコメントの中で
   「上の画像が」と書かれたときに、その指し先が後から動く。

   画像はそのまま並べる。名前の行だけにすると、
   中身を確かめるための往復が読む人の数だけ起きる。
   押すと新しいタブで開く。拡大も保存もブラウザのものがそのまま使える。
   ========================================================================== */

export type DeleteTarget = {
  readonly slug: string;
  readonly projectKey: string;
  readonly number: number;
};

const empty: AttachmentActionState = {};

export function AttachmentList({
  attachments,
  slug,
  target,
  viewerUserId,
  isOrgAdmin,
  canWrite,
}: {
  attachments: readonly AttachmentRow[];
  slug: string;
  target: DeleteTarget;
  viewerUserId: string;
  isOrgAdmin: boolean;
  /** 畳んだスレッドでは消せない。書き込みを止める線に揃えてある */
  canWrite: boolean;
}) {
  const [state, drop] = useActionState(deleteAttachmentAction, empty);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="p-attach">
      {state.error ? <p className="err">{state.error}</p> : null}
      {state.notice ? <p className="note">{state.notice}</p> : null}

      <form action={drop}>
        <input type="hidden" name="slug" value={target.slug} />
        <input type="hidden" name="key" value={target.projectKey} />
        <input type="hidden" name="number" value={target.number} />

        {attachments.map((file) => {
          const href = attachmentPath(slug, file.id);
          const confirming = state.confirming === file.id;
          const removable = canWrite && (isOrgAdmin || file.uploadedByUserId === viewerUserId);

          return (
            <div className="item" key={file.id}>
              {file.isImage ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {/* 次の画像最適化には通さない。作り直した出力をそのまま出す */}
                  {/* biome-ignore lint/performance/noImgElement: 添付は自前の経路から返す */}
                  <img src={href} alt={file.filename} />
                </a>
              ) : null}

              <p className="line">
                <a className="name" href={href}>
                  {file.isImage ? '' : '📎 '}
                  {file.filename}
                </a>
                <span className="size">{formatBytes(file.byteSize)}</span>
                {removable ? (
                  <>
                    <input
                      type="hidden"
                      name="confirm"
                      value={confirming ? '1' : ''}
                      disabled={!confirming}
                    />
                    <button className="drop" type="submit" name="attachmentId" value={file.id}>
                      {confirming ? '本当に消す' : '消す'}
                    </button>
                  </>
                ) : null}
              </p>
            </div>
          );
        })}
      </form>
    </div>
  );
}
