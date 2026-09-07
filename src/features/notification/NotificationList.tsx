import { threadLabel } from '#features/thread/path.ts';
import { formatStamp } from '#lib/datetime.ts';
import { markAllReadAction, openNotificationAction } from './actions.ts';
import type { NotificationRow } from './queries.ts';

/*
 * 通知の一覧。
 *
 * 未読と既読を混ぜて、新しい順に一本で並べる。
 * 未読だけを上に固めると、消化したあとに画面の上半分が空になる。
 * 見分けは地の色で付ける。
 *
 * 行はリンクではなくフォームである。理由は actions.ts に書いた。
 */

/** 誰が何をしたか。ウォッチの通知だけは、誰がやったかを主語にしない。 */
function headline(row: NotificationRow) {
  const who = <strong>{row.actorName ?? '退会した人'}</strong>;
  switch (row.kind) {
    case 'mention':
      return <>{who} があなたをメンションしました</>;
    case 'assigned':
      return <>{who} があなたを担当者に設定しました</>;
    case 'comment':
      return <>ウォッチ中のスレッドに新しいコメントがあります</>;
  }
}

export function NotificationList({
  slug,
  rows,
  unread,
  timezone,
}: {
  slug: string;
  rows: NotificationRow[];
  unread: number;
  timezone: string;
}) {
  return (
    <>
      <div className="app-filters">
        <span>
          未読 <strong>{unread}件</strong>
        </span>
        <span className="sp" />
        {unread > 0 ? (
          <form action={markAllReadAction}>
            <input type="hidden" name="slug" value={slug} />
            <button className="app-btn ghost" type="submit">
              すべて既読にする
            </button>
          </form>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="app-empty">通知はまだありません。</p>
      ) : (
        <div>
          {rows.map((row) => (
            <form action={openNotificationAction} key={row.id}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={row.id} />
              <button className="p-notif" data-unread={!row.read} type="submit">
                <span className="dot" aria-hidden="true" />
                <span className="n-body">
                  <span className="n-what">{headline(row)}</span>
                  <span className="n-where">
                    <span className="p-id">{threadLabel(row.projectKey, row.number)}</span>{' '}
                    {row.title}
                  </span>
                  <span className="n-when">
                    {formatStamp(row.createdAt, timezone)}
                    {/* 呼びかけが消えても、呼ばれたことは起きた出来事である */}
                    {row.commentDeleted ? (
                      <span className="badge mute">コメントは削除済み</span>
                    ) : null}
                  </span>
                </span>
              </button>
            </form>
          ))}
        </div>
      )}
    </>
  );
}
