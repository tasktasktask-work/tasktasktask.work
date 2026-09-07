import Link from 'next/link';
import { threadLabel, threadPath } from '#features/thread/path.ts';
import type { ThreadType } from '#features/thread/queries.ts';
import type { AssignedRow } from './queries.ts';

/*
 * 担当スレッドの行。
 *
 * スレッド一覧の行と形は揃えてあるが、担当者の判子は出さない。
 * 全部が自分の担当なので、並べても読み取れるものが無い。
 * 代わりにその位置へ、期限までの残りを出す。
 *
 * プロジェクトキーは必ず出す。複数のプロジェクトが混ざるので、
 * どこの話かがわからないと、次にやることを決められない。
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

/**
 * 残りの日数。
 *
 * 3日を切ったものと、過ぎたものを黄色にする。
 * 期間は日付だけを持つので、残りも日数で表せる。
 */
function Remaining({ row }: { row: AssignedRow }) {
  if (row.type !== 'kadai') {
    return <span />;
  }
  if (row.daysLeft === null) {
    return <span className="badge ki">期間未設定</span>;
  }
  if (row.daysLeft < 0) {
    return <span className="badge ki">{-row.daysLeft}日超過</span>;
  }
  return (
    <span className={row.daysLeft <= 3 ? 'badge ki' : 'badge mute'}>残り{row.daysLeft}日</span>
  );
}

export function AssignedThreadList({ slug, rows }: { slug: string; rows: AssignedRow[] }) {
  return (
    <div className="p-list">
      {rows.map((row) => (
        <div className="p-row" key={row.id}>
          <span className="p-type" data-type={row.type}>
            {TYPE_LABEL[row.type]}
          </span>

          <Link className="ttl" href={threadPath(slug, row.projectKey, row.number)}>
            {row.title}
          </Link>

          {row.type === 'kadai' ? (
            <span className="p-progress" data-zero={row.progress === 0}>
              <span className="bar">
                <span className="fill" style={{ width: `${row.progress}%` }} />
              </span>
              <span className="num">{row.progress}%</span>
            </span>
          ) : (
            <span className="p-oc" data-oc={row.progress === 100 ? 'close' : 'open'}>
              {row.progress === 100 ? 'クローズ' : 'オープン'}
            </span>
          )}

          <Remaining row={row} />

          <span className="p-id">{threadLabel(row.projectKey, row.number)}</span>

          <span className="meta">
            {row.startsOn && row.endsOn ? (
              <span>
                {shortDay(row.startsOn)} – {shortDay(row.endsOn)}
              </span>
            ) : row.type === 'kadai' ? (
              <span>日付を入れてください</span>
            ) : (
              <span>期間なし</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
