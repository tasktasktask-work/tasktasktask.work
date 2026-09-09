import Link from 'next/link';
import { TagList } from '#features/tag/TagChip.tsx';
import { formatStamp } from '#lib/datetime.ts';
import { threadLabel, threadPath } from './path.ts';
import type { ThreadRow, ThreadType } from './queries.ts';

/*
 * スレッドの行。
 *
 * 一覧のための形である。
 * 詳細の右の欄に出す子スレッドは ThreadChildren.tsx にあり、そちらは別の形をしている。
 * 一覧は横に並べて比べるためのもので、あちらは一件ずつ辿るためのものである。
 *
 * 階層は作らない。親と子へは、行に置いたリンクから辿る。
 * 木で並べると、絞り込んだときに「親が条件に合わないが子は合う」行の
 * 置き場所が無くなる。
 */

const TYPE_LABEL: Record<ThreadType, string> = {
  kadai: '課題',
  giron: '議論',
  shitsumon: '質問',
};

/** 2026-09-08 を 9/8 にする。桁を食わせない。 */
function shortDay(value: string): string {
  const [, month, day] = value.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function ThreadRows({
  slug,
  threads,
  timezone,
}: {
  slug: string;
  threads: ThreadRow[];
  timezone: string;
}) {
  return (
    <div className="p-list">
      {threads.map((thread) => (
        <div className="p-row" data-archived={thread.archived} key={thread.id}>
          <span className="p-type" data-type={thread.type}>
            {TYPE_LABEL[thread.type]}
          </span>

          <Link className="ttl" href={threadPath(slug, thread.projectKey, thread.number)}>
            {thread.title}
          </Link>

          {thread.type === 'kadai' ? (
            <span
              className="p-progress"
              data-zero={thread.progress === 0}
              data-done={thread.progress === 100}
            >
              <span className="bar">
                <span className="fill" style={{ width: `${thread.progress}%` }} />
              </span>
              <span className="num">{thread.progress}%</span>
            </span>
          ) : (
            <span className="p-oc" data-oc={thread.progress === 100 ? 'close' : 'open'}>
              {thread.progress === 100 ? 'クローズ' : 'オープン'}
            </span>
          )}

          {thread.assigneeName ? (
            <span className="hanko sm" title={thread.assigneeName} aria-hidden="true">
              {[...thread.assigneeName][0] ?? '?'}
            </span>
          ) : (
            <span />
          )}

          <span className="p-id">{threadLabel(thread.projectKey, thread.number)}</span>

          <span className="meta">
            <TagList tags={thread.tags} />

            {thread.archived ? <span className="badge mute">アーカイブ済み</span> : null}

            {thread.parentNumber !== null ? (
              <Link
                className="rel-link"
                href={threadPath(slug, thread.projectKey, thread.parentNumber)}
              >
                ← 親 {threadLabel(thread.projectKey, thread.parentNumber)}
              </Link>
            ) : null}

            {thread.childCount > 0 ? (
              <Link
                className="rel-link"
                href={threadPath(slug, thread.projectKey, thread.number)}
              >
                子 {thread.childCount}件 →
              </Link>
            ) : null}

            {thread.overflow ? <span className="badge ki">親からはみ出し</span> : null}

            {thread.type === 'kadai' && thread.startsOn === null ? (
              <span className="badge ki">期間未設定</span>
            ) : null}

            {thread.startsOn && thread.endsOn ? (
              <span>
                {shortDay(thread.startsOn)} – {shortDay(thread.endsOn)}
              </span>
            ) : null}

            {thread.assigneeName === null ? <span>担当者なし</span> : null}

            <span>更新 {formatStamp(thread.updatedAt, timezone)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
