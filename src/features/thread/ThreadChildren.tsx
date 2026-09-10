import Link from 'next/link';
import { ChildThreadForm } from './ChildThreadForm.tsx';
import { threadLabel, threadPath } from './path.ts';
import type { ThreadRow, ThreadType } from './queries.ts';

/*
 * 詳細画面の右の欄に置く子スレッド。
 *
 * 一覧の ThreadRows を狭めたものではない。
 * 一覧は横に並べて比べるための形で、こちらは一件ずつ辿るための形である。
 * 5つの列を 18rem に詰めると、どの列も読めなくなる。
 *
 * 下段にはみ出しの印を出す。
 * 上に出る「子スレッドの期間が、このスレッドの期間の外に出ています。」と対になっていて、
 * どの子がそうなのかは、ここでしか分からない。
 * 一覧では親の行に印を出さない。十件ぶら下がっていても、どれかが分からないためである。
 */

const TYPE_LABEL: Record<ThreadType, string> = {
  kadai: '課題',
  giron: '議論',
  shitsumon: '質問',
};

export function ThreadChildren({
  slug,
  projectKey,
  parentNumber,
  threads,
  canWrite,
}: {
  slug: string;
  projectKey: string;
  /** 子を立てるときの親。この画面のスレッドである */
  parentNumber: number;
  threads: readonly ThreadRow[];
  /** 畳んであるときは、立てる導線を消す */
  canWrite: boolean;
}) {
  // 0件で、しかも立てられないときは、欄そのものを出さない
  if (threads.length === 0 && !canWrite) {
    return null;
  }

  return (
    <section>
      <h3>
        子スレッド{threads.length > 0 ? <span className="n"> {threads.length}</span> : null}
      </h3>

      {threads.map((child) => (
        <Link
          className="p-child"
          data-archived={child.archived}
          href={threadPath(slug, child.projectKey, child.number)}
          key={child.id}
        >
          <span className="p-type" data-type={child.type}>
            {TYPE_LABEL[child.type]}
          </span>

          <span className="ttl">{child.title}</span>

          <span className="meta">
            <span className="p-id">{threadLabel(child.projectKey, child.number)}</span>

            {child.type === 'kadai' ? (
              <span
                className="p-progress"
                data-zero={child.progress === 0}
                data-done={child.progress === 100}
              >
                <span className="bar">
                  <span className="fill" style={{ width: `${child.progress}%` }} />
                </span>
                <span className="num">{child.progress}%</span>
              </span>
            ) : (
              <span className="p-oc" data-oc={child.progress === 100 ? 'close' : 'open'}>
                {child.progress === 100 ? 'クローズ' : 'オープン'}
              </span>
            )}

            {child.assigneeName ? (
              <span className="hanko sm" title={child.assigneeName} aria-hidden="true">
                {[...child.assigneeName][0] ?? '?'}
              </span>
            ) : null}

            {child.overflow ? <span className="badge ki">親からはみ出し</span> : null}

            {child.archived ? <span className="badge mute">アーカイブ済み</span> : null}
          </span>
        </Link>
      ))}

      {/* 番号を書き写させない。書き写さない人が出て、親子が切れる */}
      {canWrite ? (
        <div className="foot">
          <ChildThreadForm slug={slug} projectKey={projectKey} parentNumber={parentNumber} />
        </div>
      ) : null}
    </section>
  );
}
