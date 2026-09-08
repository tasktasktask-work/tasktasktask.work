/* ==========================================================================
   ガントの組み立て

   ここにはデータベースも React も出てこない。
   行を木に組み直し、並べ、切り、描く範囲を決めるところまでを引き受ける。

   分けてあるのは、この画面の判断のほとんどが「どの行を出すか」に
   集まっているためである。問い合わせと描画に混ぜると、
   はみ出しの判定も、切ったときの祖先の扱いも、画面を開かないと確かめられない。

   仕様は docs/features/gantt/index.html にある。
   ========================================================================== */

/** 図に出しうる課題。問い合わせの結果をそのまま受ける形にしてある。 */
export type GanttThread = {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly progress: number;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly assigneeName: string | null;
  readonly archived: boolean;
  /** 生きている親の id。親が消えているか、議論・質問なら null になる。 */
  readonly parentId: string | null;
  readonly parentNumber: number | null;
};

export type GanttRow = {
  readonly thread: GanttThread;
  readonly depth: number;
  /** 自分が親の期間の外に出ている。親子の両方に期間があるときだけ真になる。 */
  readonly overflow: boolean;
  /** 直接の子にはみ出しがある。折りたたんでもこの印は残す。 */
  readonly childOverflow: boolean;
  /** 図に出ている子孫の数。折りたたんだときに件数として出す。 */
  readonly descendants: number;
  /**
   * 親はいるが、図には出ていない。
   *
   * 親が議論か質問のときに起きる。行として出せないので最上位へ上げるが、
   * そのままだと外れて見える理由が読めない。親の番号を添えるために立てる。
   */
  readonly orphaned: boolean;
};

/** 一枚に描く課題の数の目安。祖先を足したぶんは超える。 */
export const ROW_LIMIT = 500;

/** 期間未設定の枠に並べる数。 */
export const UNDATED_LIMIT = 100;

/** 図の左右に置く余白の日数。 */
const PAD_DAYS = 3;

/* --------------------------------------------------------------------------
   日付
   -------------------------------------------------------------------------- */

/*
 * date 列は 'YYYY-MM-DD' の文字列のまま流れてくる。
 * ここで Date にすると、その時点で実行環境のタイムゾーンぶんずれる。
 * 日数の計算だけは UTC の正午に置いて行い、返す形は文字列に戻す。
 */

const DAY = 86_400_000;

function toUtc(day: string): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return Date.UTC(year, month - 1, date, 12);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** from から day までの日数。同じ日なら 0。 */
export function dayIndex(day: string, from: string): number {
  return Math.round((toUtc(day) - toUtc(from)) / DAY);
}

export function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * DAY);
}

/** 月曜を 0 とした曜日。土日の縞をどこから始めるかに使う。 */
export function weekdayIndex(day: string): number {
  return (new Date(toUtc(day)).getUTCDay() + 6) % 7;
}

/* --------------------------------------------------------------------------
   行を選ぶ
   -------------------------------------------------------------------------- */

/**
 * 同じ階層の中の並び。
 *
 * 開始日の早い順。同じなら終了日の早い順、それも同じなら課題番号の若い順。
 * 期間を持たない行は、その階層の末尾に置く。
 */
function compare(a: GanttThread, b: GanttThread): number {
  if (a.startsOn !== b.startsOn) {
    if (a.startsOn === null) {
      return 1;
    }
    if (b.startsOn === null) {
      return -1;
    }
    return a.startsOn < b.startsOn ? -1 : 1;
  }
  if (a.endsOn !== b.endsOn && a.endsOn !== null && b.endsOn !== null) {
    return a.endsOn < b.endsOn ? -1 : 1;
  }
  return a.number - b.number;
}

export type Selection = {
  readonly rows: readonly GanttRow[];
  /** 期間を持つ課題のうち、実際に描いたもの。 */
  readonly drawn: number;
  /** 期間を持つ課題の総数。drawn を超えていれば切っている。 */
  readonly dated: number;
};

/**
 * 図に出す行を選び、木に組み直して平らに並べる。
 *
 * 種になるのは、期間を持ち、畳まれていない課題である。
 * そこから親を辿り、途中の課題は期間が無くても、畳んであっても残す。
 * 残さないと、子のインデントの根拠が消えて宙に浮く。
 *
 * 数を切るのは種の側だけで、祖先は順位に関わらず残す。
 * 親だけが落ちると枝ごと意味を失うので、上限は目安として扱う。
 */
export function selectRows(threads: readonly GanttThread[], limit = ROW_LIMIT): Selection {
  const index = new Map(threads.map((t) => [t.id, t]));

  const seeds = threads.filter((t) => t.startsOn !== null && !t.archived).sort(compare);
  const chosen = seeds.slice(0, limit);

  const keep = new Set<string>();
  for (const seed of chosen) {
    let current: GanttThread | undefined = seed;
    // 万一データが輪になっていたときに戻らなくなるのを防ぐ。
    // 仕様としての階層の上限ではない（setParent と同じ理由で 50 にしてある）。
    for (let step = 0; current && step < 50; step += 1) {
      if (keep.has(current.id)) {
        break;
      }
      keep.add(current.id);
      current = current.parentId === null ? undefined : index.get(current.parentId);
    }
  }

  const drawnThreads = threads.filter((t) => keep.has(t.id));
  const children = new Map<string, GanttThread[]>();
  const roots: GanttThread[] = [];
  for (const thread of drawnThreads) {
    const parent =
      thread.parentId !== null && keep.has(thread.parentId) ? thread.parentId : null;
    if (parent === null) {
      roots.push(thread);
    } else {
      const list = children.get(parent);
      if (list) {
        list.push(thread);
      } else {
        children.set(parent, [thread]);
      }
    }
  }

  roots.sort(compare);
  for (const list of children.values()) {
    list.sort(compare);
  }

  const rows: GanttRow[] = [];
  const seen = new Set<string>();
  const walk = (thread: GanttThread, depth: number, parent: GanttThread | null): number => {
    if (seen.has(thread.id)) {
      return 0;
    }
    seen.add(thread.id);
    const kids = children.get(thread.id) ?? [];
    const slot = rows.length;
    // 子孫の数は下を歩き終えるまで分からない。場所だけ先に取る。
    rows.push({
      thread,
      depth,
      overflow: outside(thread, parent),
      childOverflow: kids.some((kid) => outside(kid, thread)),
      descendants: 0,
      orphaned: thread.parentNumber !== null && parent === null,
    });
    let count = 0;
    for (const kid of kids) {
      count += walk(kid, depth + 1, thread);
    }
    const placed = rows[slot];
    if (placed) {
      rows[slot] = { ...placed, descendants: count };
    }
    return count + 1;
  };
  for (const root of roots) {
    walk(root, 0, null);
  }

  /*
   * 輪になっている行を拾い上げる。
   *
   * 親を辿って根に着かない行は、上の歩きに現れない。
   * 輪は付け替えのときに弾いているが、弾き漏れたときに
   * 図が丸ごと空になるのは、いちばん困る壊れ方である。
   * 残ったものを最上位として並べ、少なくとも読める状態にする。
   */
  for (const thread of drawnThreads) {
    if (!seen.has(thread.id)) {
      walk(thread, 0, null);
    }
  }

  return { rows, drawn: chosen.length, dated: seeds.length };
}

/*
 * 期間は両方入るか両方空くかのどちらかである（threads_period_paired）。
 * 型はそれを知らないので、片方だけ入った形も表せてしまう。
 * ここで一度だけ組にしておき、使う側で二度確かめずに済ませる。
 */
function period(thread: GanttThread): { from: string; to: string } | null {
  return thread.startsOn !== null && thread.endsOn !== null
    ? { from: thread.startsOn, to: thread.endsOn }
    : null;
}

/**
 * 子が親の期間の外に出ているか。
 *
 * 見るのは直接の親だけである。孫が祖父の期間を越えていても、
 * 親の期間に収まっていれば印は出ない。連鎖しているなら各段に出る。
 * どちらかに期間が無い組は判定しない。それは別枠が伝えることである。
 */
function outside(child: GanttThread, parent: GanttThread | null): boolean {
  const inner = period(child);
  const outer = parent === null ? null : period(parent);
  if (!inner || !outer) {
    return false;
  }
  return inner.from < outer.from || inner.to > outer.to;
}

/* --------------------------------------------------------------------------
   描く範囲
   -------------------------------------------------------------------------- */

export type Range = {
  readonly from: string;
  readonly to: string;
  readonly days: number;
  /** 今日が左から何日目か。範囲には必ず入るので、0 以上 days 未満になる。 */
  readonly todayIndex: number;
  /** 土日の縞をずらす日数。範囲の初日の曜日で決まる。 */
  readonly weekOffset: number;
};

/**
 * 横軸の範囲を決める。
 *
 * 描く課題の最小の開始日から最大の終了日まで。今日がその外なら今日まで伸ばす。
 * 決めるのに使うのは、切った後の実際に描く行だけである。
 * 描かないものに合わせて幅を取ると、誰のものでもない空白が端にできる。
 */
export function computeRange(rows: readonly GanttRow[], today: string): Range {
  let from = today;
  let to = today;
  for (const row of rows) {
    const { startsOn, endsOn } = row.thread;
    if (startsOn !== null && startsOn < from) {
      from = startsOn;
    }
    if (endsOn !== null && endsOn > to) {
      to = endsOn;
    }
  }

  const start = addDays(from, -PAD_DAYS);
  const end = addDays(to, PAD_DAYS);
  return {
    from: start,
    to: end,
    days: dayIndex(end, start) + 1,
    todayIndex: dayIndex(today, start),
    weekOffset: weekdayIndex(start),
  };
}

/** 年月の帯。範囲を月ごとに切って、それぞれの日数を返す。 */
export function monthBands(range: Range): { label: string; days: number }[] {
  const bands: { label: string; days: number }[] = [];
  for (let i = 0; i < range.days; i += 1) {
    const day = addDays(range.from, i);
    const label = `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月`;
    const last = bands[bands.length - 1];
    if (last && last.label === label) {
      last.days += 1;
    } else {
      bands.push({ label, days: 1 });
    }
  }
  return bands;
}

/** バーの置き場所。範囲の左端からの日数と、日数ぶんの長さで表す。 */
export type Placement = { readonly offset: number; readonly length: number };

/**
 * バーを置く位置。範囲の外へ出る部分は切り詰める。
 *
 * 切り詰めが起きるのは、範囲を描く行から決めているためではなく、
 * 畳んだ祖先が遠い期間を持っている場合である。
 */
export function placeBar(thread: GanttThread, range: Range): Placement | null {
  const span = period(thread);
  if (!span) {
    return null;
  }
  const start = Math.max(0, dayIndex(span.from, range.from));
  const end = Math.min(range.days - 1, dayIndex(span.to, range.from));
  if (end < start) {
    return null;
  }
  return { offset: start, length: end - start + 1 };
}
