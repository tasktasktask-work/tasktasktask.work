'use client';

import Link from 'next/link';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { threadLabel, threadPath } from '#features/thread/path.ts';
import { addDays, type GanttRow, monthBands, placeBar, type Range } from './layout.ts';
import type { Counts } from './queries.ts';

/* ==========================================================================
   ガントの図

   ブラウザ側に置いてあるのは二つだけである。
   親の下を折りたたむことと、開いた直後に今日の位置までスクロールすること。

   「畳む」はこのシステムではアーカイブを指す。行を閉じるほうは
   折りたたみと呼び、画面の言葉も「隠す」「出す」で通す。
   どちらもサーバー側では決められない。

   バーは掴めない。期間を変えるのはスレッドの詳細画面である。
   押せないことを、押してから知る形にしないため、リンクにするのは名前だけにしてある。
   ========================================================================== */

/** 2026-09-03 を 2026/09/03 にする。触れたときに出す表示に使う。 */
function slashed(day: string): string {
  return day.replace(/-/g, '/');
}

export function GanttChart({
  slug,
  projectKey,
  rows,
  range,
  counts,
}: {
  slug: string;
  projectKey: string;
  rows: readonly GanttRow[];
  range: Range;
  counts: Counts;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const scale = useRef<HTMLDivElement>(null);

  const toToday = useCallback(
    (smooth: boolean) => {
      const box = scroller.current;
      const ruler = scale.current;
      if (!box || !ruler) {
        return;
      }
      const perDay = ruler.clientWidth / range.days;
      // 今日を左から四分の一の位置に置く。先の予定のほうを広く見せる
      const left = range.todayIndex * perDay - box.clientWidth * 0.25;
      box.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
    },
    [range.days, range.todayIndex],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いた直後の一度だけ合わせる
  useEffect(() => {
    toToday(false);
  }, []);

  const flip = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };

  /*
   * 折りたたんだ親の下は出さない。
   *
   * 行は深さつきで平らに並んでいるので、折りたたんだ行より深い行を、
   * 同じ深さに戻るまで飛ばせばよい。木をもう一度たどる必要がない。
   */
  const visible: GanttRow[] = [];
  let hideBelow: number | null = null;
  for (const row of rows) {
    if (hideBelow !== null && row.depth > hideBelow) {
      continue;
    }
    hideBelow = null;
    visible.push(row);
    if (collapsed.has(row.thread.id)) {
      hideBelow = row.depth;
    }
  }

  const bands = monthBands(range);

  return (
    <div className="p-gantt">
      {/* 絞り込みは置かない。絞ると親の消えた子が出て、階層の置き場所がまた要る */}
      <div className="app-filters">
        <span className="p-gantt-count">
          {counts.total}件のうち 期間あり {counts.dated}件
        </span>
        <span className="p-gantt-range">
          {slashed(range.from)} 〜 {slashed(range.to)}
        </span>
        <span className="sp" />
        <button type="button" className="app-btn ghost" onClick={() => toToday(true)}>
          今日へ戻る
        </button>
      </div>

      <div
        className="p-gantt-scroll"
        ref={scroller}
        style={
          {
            '--days': range.days,
            '--wk': range.weekOffset,
            '--ti': range.todayIndex,
          } as CSSProperties
        }
      >
        <div className="p-gantt-grid">
          <div className="p-gantt-corner" />
          <div className="p-gantt-months">
            {bands.map((band) => (
              <span key={band.label} style={{ width: `calc(${band.days} * var(--day))` }}>
                {band.label}
              </span>
            ))}
          </div>

          <div className="p-gantt-corner low" />
          <div className="p-gantt-scale" ref={scale}>
            {Array.from({ length: range.days }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 目盛りは範囲が変わるまで動かない
              <span key={i}>{Number(addDays(range.from, i).slice(8, 10))}</span>
            ))}
          </div>

          {visible.map((row) => (
            <Row
              key={row.thread.id}
              row={row}
              range={range}
              slug={slug}
              projectKey={projectKey}
              collapsed={collapsed.has(row.thread.id)}
              onFlip={flip}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  row,
  range,
  slug,
  projectKey,
  collapsed,
  onFlip,
}: {
  row: GanttRow;
  range: Range;
  slug: string;
  projectKey: string;
  collapsed: boolean;
  onFlip: (id: string) => void;
}) {
  const { thread } = row;
  const bar = placeBar(thread, range);
  const done = thread.progress === 100;

  return (
    <>
      <div className="p-gantt-name" style={{ '--depth': row.depth } as CSSProperties}>
        {row.descendants > 0 ? (
          <button
            type="button"
            className="fold"
            aria-expanded={!collapsed}
            aria-label={collapsed ? '子を出す' : '子を隠す'}
            onClick={() => onFlip(thread.id)}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="fold" />
        )}

        <Link className="ttl" href={threadPath(slug, projectKey, thread.number)}>
          {thread.title}
        </Link>

        {/* 親が議論か質問のとき。行として出せないので最上位に上げてある */}
        {row.orphaned && row.thread.parentNumber !== null ? (
          <span className="p-gantt-of" title="親は議論か質問のため、図には出ません">
            ↳{threadLabel(projectKey, row.thread.parentNumber)}
          </span>
        ) : null}

        {thread.startsOn === null ? (
          <span className="p-gantt-flag" title="期間が入っていません">
            期間なし
          </span>
        ) : null}

        {thread.archived ? (
          <span className="p-gantt-flag" data-archived="true">
            アーカイブ済み
          </span>
        ) : null}

        {collapsed && row.descendants > 0 ? (
          <span className="p-gantt-hidden">＋{row.descendants}</span>
        ) : null}

        {/* はみ出しの印は折りたたんでも残す。閉じたせいで見落とさないように */}
        {row.childOverflow ? (
          <span className="p-gantt-warn" title="子が親の期間からはみ出しています">
            ⚠
          </span>
        ) : null}

        {thread.assigneeName ? (
          <span className="hanko sm" title={thread.assigneeName} aria-hidden="true">
            {[...thread.assigneeName][0] ?? '?'}
          </span>
        ) : null}
      </div>

      <div className="p-gantt-track">
        {bar && thread.startsOn && thread.endsOn ? (
          <span
            className="p-gantt-bar"
            data-parent={row.descendants > 0}
            data-complete={done}
            data-overflow={row.overflow}
            data-archived={thread.archived}
            style={{ '--o': bar.offset, '--l': bar.length } as CSSProperties}
            title={`${slashed(thread.startsOn)} 〜 ${slashed(thread.endsOn)} 進捗 ${thread.progress}%`}
          >
            {thread.archived ? null : (
              <span className="done" style={{ width: `${thread.progress}%` }} />
            )}
          </span>
        ) : null}
      </div>
    </>
  );
}
