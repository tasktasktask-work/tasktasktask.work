/* ==========================================================================
   Markdown の下ごしらえ

   描画そのものは streamdown が行う。ここがやるのは、その手前で本文を
   一度だけ走査し、こちらが意味を与えたい二つのものに印を付けることである。

   1. チェックボックス  `- [ ] やること` の `[ ]` を `<task>` に置き換える
   2. メンション        `@佐藤 明日香` を `<mention>` で包む

   なぜ置き換えるのか。streamdown からカスタムコンポーネントに渡ってくるのは
   `type` `checked` `disabled` と hast のノードだけで、位置情報は落とされている。
   描画された側から「本文の何番目のチェックボックスか」を知る手段がない。
   番号が要るのは、状態を別のテーブルに置いたためである
   （docs/features/comment/index.html を参照）。

   走査はコードの中を避ける。コードブロックの中の `- [ ] ...` は文章であって
   チェックボックスではないし、`@example` はメンションではない。
   ここを間違えると、コード例が壊れて表示される。

   利用者が自分で `<task>` や `<mention>` と書いた場合は、こちらが埋め込むものと
   区別が付かなくなる。他人を指名したように見せかける文字列を作れてしまうので、
   下ごしらえの段階でエスケープする。
   ========================================================================== */

/** 本文の中のチェックボックス一つ分。 */
export type TaskItem = {
  /** 本文の中で何番目か。0 始まり。これが comment_checks.position になる */
  readonly position: number;
  /** 本文の記法そのものの状態（`[x]` なら真）。コメントでは表示に使わない */
  readonly checked: boolean;
  /** `[` の位置 */
  readonly start: number;
  /** `]` の次の位置 */
  readonly end: number;
};

export type Span = { readonly start: number; readonly end: number };

/** メンションの候補。そのプロジェクトを閲覧できる人だけが入る。 */
export type Candidate = { readonly userId: string; readonly displayName: string };

/** 解決したメンション。同姓同名がいれば userIds が複数になる。 */
export type Mention = Span & { readonly userIds: readonly string[] };

/* --------------------------------------------------------------------------
   走査

   コードの範囲を求めるのと、チェックボックスを拾うのを一度に行う。
   本文は短いので、位置ごとの真偽値を並べた表を持つほうが読みやすい。
   -------------------------------------------------------------------------- */

/** 行の切り出し。末尾の改行は text に含めない。 */
function eachLine(source: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      out.push({ start, text: source.slice(start, i) });
      start = i + 1;
    }
  }
  if (start < source.length) {
    out.push({ start, text: source.slice(start) });
  }
  return out;
}

/** 囲みの開始。``` でも ~~~ でも、三つ以上なら開く。 */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** 囲みの終わり。開いたものと同じ文字で、同じ数以上で、後ろに何も付かない。 */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * チェックボックスの行。
 *
 * GFM では箇条書きの項目の先頭にあるものだけがチェックボックスになる。
 * 後ろに空白か行末が続くことも要る（`[x]y` は文章である）。
 */
const TASK_LINE = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\](?=[ \t]|$)/;
/** 箇条書きの項目かどうか。字下げの深い行を許すかの判定に使う */
const LIST_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/;

export type Analysis = {
  /** その位置がコード（囲みの中か、`…` の中）なら 1 */
  readonly mask: Uint8Array;
  readonly tasks: readonly TaskItem[];
};

export function analyze(source: string): Analysis {
  const mask = new Uint8Array(source.length);
  const found: { checked: boolean; start: number; end: number }[] = [];

  let fence: { char: string; length: number } | null = null;
  let previousWasList = false;

  for (const line of eachLine(source)) {
    const cover = () => {
      for (let i = line.start; i < line.start + line.text.length; i++) {
        mask[i] = 1;
      }
    };

    if (fence) {
      cover();
      const close = FENCE_CLOSE.exec(line.text)?.[1] ?? '';
      if (close.startsWith(fence.char) && close.length >= fence.length) {
        fence = null;
      }
      continue;
    }

    const open = FENCE_OPEN.exec(line.text);
    if (open) {
      // ``` の情報文字列にバッククォートは置けない。`a ` b` のような行を
      // 囲みの開始と読み違えないための、GFM の決まりである。
      const marker = open[1] ?? '';
      const info = open[2] ?? '';
      if (!(marker.startsWith('`') && info.includes('`'))) {
        fence = { char: marker.slice(0, 1), length: marker.length };
        cover();
        continue;
      }
    }

    const task = TASK_LINE.exec(line.text);
    if (task) {
      /*
       * 半角空白4つ以上の字下げは、本来ならコードブロックである。
       * ただし箇条書きの中の入れ子も同じだけ下がるので、
       * 直前が箇条書きの行だったときは深い字下げも受ける。
       */
      const indent = (task[1] ?? '').replace(/\t/g, '    ').length;
      if (indent <= 3 || previousWasList) {
        const end = line.start + task[0].length;
        found.push({ checked: task[2] !== ' ', start: end - 3, end });
      }
    }

    if (line.text.trim() !== '') {
      previousWasList = LIST_LINE.test(line.text);
    }
  }

  maskInlineCode(source, mask);

  // 囲みの外にあっても `…` の中に入ってしまったものは、文章である。
  const tasks: TaskItem[] = [];
  for (const item of found) {
    if (mask[item.start]) {
      continue;
    }
    tasks.push({ position: tasks.length, ...item });
  }

  return { mask, tasks };
}

/**
 * `…` の範囲に印を付ける。
 *
 * 開いたバッククォートの数と、同じ数で閉じたところまでが一つの範囲である。
 * 閉じるものがなければ、ただの文字として扱う。
 */
function maskInlineCode(source: string, mask: Uint8Array): void {
  let i = 0;
  while (i < source.length) {
    if (mask[i] === 1 || source[i] !== '`') {
      i++;
      continue;
    }

    const open = runLength(source, mask, i);
    let j = i + open;
    let closed = -1;
    while (j < source.length) {
      if (mask[j] === 1 || source[j] !== '`') {
        j++;
        continue;
      }
      const run = runLength(source, mask, j);
      if (run === open) {
        closed = j + run;
        break;
      }
      j += run;
    }

    if (closed === -1) {
      i += open;
      continue;
    }
    for (let k = i; k < closed; k++) {
      mask[k] = 1;
    }
    i = closed;
  }
}

function runLength(source: string, mask: Uint8Array, from: number): number {
  let n = 0;
  while (from + n < source.length && source[from + n] === '`' && mask[from + n] === 0) {
    n++;
  }
  return n;
}

/** 本文の中のチェックボックスを、現れる順に返す。 */
export function findTasks(source: string): readonly TaskItem[] {
  return analyze(source).tasks;
}

/* --------------------------------------------------------------------------
   メンション
   -------------------------------------------------------------------------- */

/**
 * `@` に続く表示名を最長一致で拾う。
 *
 * 表示名には空白が入るうえ、一意でもない。
 * どこまでが名前かを決める手立てが要るので、閲覧できる人の一覧と突き合わせ、
 * 最も長く一致したものを採る。同じ表示名の人が複数いれば、その全員を指名とみなす。
 *
 * `@` の直前が英数字なら見送る。メールアドレスを指名と読まないためである。
 */
export function findMentions(
  source: string,
  candidates: readonly Candidate[],
  analysis: Analysis = analyze(source),
): Mention[] {
  if (candidates.length === 0) {
    return [];
  }

  const byName = new Map<string, string[]>();
  for (const candidate of candidates) {
    const name = candidate.displayName;
    const list = byName.get(name);
    if (list) {
      list.push(candidate.userId);
    } else {
      byName.set(name, [candidate.userId]);
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);

  const { mask } = analysis;
  const out: Mention[] = [];

  let i = 0;
  while (i < source.length) {
    if (source[i] !== '@') {
      i++;
      continue;
    }
    const before = i > 0 ? (source[i - 1] ?? '') : '';
    if (/[0-9A-Za-z_@]/.test(before)) {
      i++;
      continue;
    }

    const matched = names.find(
      (name) =>
        name !== '' && source.startsWith(name, i + 1) && !covered(mask, i, i + 1 + name.length),
    );
    if (!matched) {
      i++;
      continue;
    }

    const end = i + 1 + matched.length;
    out.push({ start: i, end, userIds: byName.get(matched) ?? [] });
    i = end;
  }

  return out;
}

/**
 * 範囲のどこかがコードに掛かっているか。
 *
 * コードの中を指名として拾わないための判定は、ここ一箇所である。
 * `@` の位置だけを見る判定を別に置いていたが、この関数が同じことを
 * より広く行うので、二重にしても片方が試されないまま残るだけだった。
 */
function covered(mask: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end && i < mask.length; i++) {
    if (mask[i] === 1) {
      return true;
    }
  }
  return false;
}

/* --------------------------------------------------------------------------
   書き換え
   -------------------------------------------------------------------------- */

/**
 * N 番目のチェックボックスだけを差し替える。
 *
 * スレッドの本文で使う。こちらは編集できるので、状態を本文に書く。
 * 本文を丸ごと組み立て直すのではなく三文字だけ差し替えるので、
 * 別の箱を同時に押されても、互いの変更を消さない
 * （呼ぶ側が同じトランザクションの中で読み直すこと）。
 *
 * その番号の箱が無ければ null。本文が先に編集されたということである。
 */
export function toggleTask(source: string, position: number, checked: boolean): string | null {
  const item = analyze(source).tasks[position];
  if (!item) {
    return null;
  }
  return source.slice(0, item.start) + (checked ? '[x]' : '[ ]') + source.slice(item.end);
}

/** こちらが埋め込むタグ。streamdown の allowedTags と揃える。 */
export const MARKDOWN_TAGS = {
  task: ['i', 'state'],
  mention: [],
} as const;

export type PrepareOptions = {
  /** 位置を渡すと、その範囲を指名として包む */
  readonly mentions?: readonly Span[];
  /** チェックボックスの状態をどこから取るか。省かれたら押せない見た目のまま出す */
  readonly checked?: (item: TaskItem) => boolean;
};

/**
 * 本文を streamdown に渡せる形にする。
 *
 * 置き換えは後ろから当てる。前から当てると、一つ書き換えるたびに
 * 後ろの位置がずれていく。
 */
export function prepare(source: string, options: PrepareOptions = {}): string {
  const analysis = analyze(source);
  const edits: { start: number; end: number; text: string }[] = [];

  // 利用者が書いた <task> と <mention> を無効にする。
  // コードの中はそのまま残す。書いたとおりに出るのが正しい。
  for (const match of source.matchAll(/<\/?(?:task|mention)\b/gi)) {
    const at = match.index;
    if (analysis.mask[at] === 1) {
      continue;
    }
    edits.push({ start: at, end: at + 1, text: '&lt;' });
  }

  if (options.checked) {
    for (const item of analysis.tasks) {
      const state = options.checked(item) ? 'on' : 'off';
      edits.push({
        start: item.start,
        end: item.end,
        text: `<task i="${item.position}" state="${state}"></task>`,
      });
    }
  }

  for (const span of options.mentions ?? []) {
    const inner = source.slice(span.start, span.end);
    edits.push({
      start: span.start,
      end: span.end,
      text: `<mention>${escapeText(inner)}</mention>`,
    });
  }

  edits.sort((a, b) => b.start - a.start);

  let out = source;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** タグの中身に入れる文字。表示名に記号が入っていても壊れないようにする。 */
function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
