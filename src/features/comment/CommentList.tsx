import { formatDateTime } from '#lib/datetime.ts';
import { prepare } from '#lib/markdown.ts';
import { Markdown } from './Markdown.tsx';
import type { CommentRow } from './queries.ts';

/* ==========================================================================
   コメントの列

   古い順に一本で並ぶ。枝分かれはしない。

   本文の下ごしらえはここで行う。
   指名の位置は投稿時に記録したものを使い、表示のたびに解決し直さない。
   チェックボックスの状態は comment_checks から来るので、
   本文に書かれた [x] とは食い違うことがある。優先するのはテーブルの側である。
   ========================================================================== */

export type CommentTarget = {
  readonly slug: string;
  readonly projectKey: string;
  readonly number: number;
};

export function CommentList({
  comments,
  target,
  canWrite,
  timezone,
}: {
  comments: readonly CommentRow[];
  target: CommentTarget;
  /** 畳んだスレッドではチェックボックスも押せない */
  canWrite: boolean;
  timezone: string;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--rule)' }}>
      {comments.map((comment) => (
        <div className="p-comment" id={`c-${comment.id}`} key={comment.id}>
          <span className="hanko" aria-hidden="true">
            {comment.deleted ? '×' : ([...comment.authorName][0] ?? '?')}
          </span>
          <div className="body">
            <div className="head">
              <span className="who">{comment.authorName}</span>
              <span className="when">{formatDateTime(comment.createdAt, timezone)}</span>
            </div>

            {comment.deleted ? (
              <p className="p-deleted">このコメントは削除されました。</p>
            ) : (
              <div className="text">
                <Markdown
                  source={prepare(comment.body, {
                    mentions: comment.mentions,
                    checked: (item) => comment.checks.includes(item.position),
                  })}
                  target={
                    canWrite
                      ? {
                          kind: 'comment',
                          slug: target.slug,
                          key: target.projectKey,
                          number: target.number,
                          commentId: comment.id,
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
