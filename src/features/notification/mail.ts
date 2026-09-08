import { threadLabel, threadPath } from '#features/thread/path.ts';
import type { Mail } from '#lib/mail.ts';
import type { NotificationKind } from './queries.ts';

/* ==========================================================================
   通知メールの文面

   組み立てだけを行い、送らない。
   送る仕掛け（mailer.ts）は取引と外への呼び出しを抱えていて、
   テストから素直に呼べない。文面の判断をそちらへ混ぜると、
   「三件まとまったときにどう書くか」を確かめるのにデータベースが要る。

   宛先ごとに一通へまとめる。一巡のあいだに積まれた行が全部入る。
   会議がひとつ荒れると、一人に十数通が数分で届く。
   無料枠は月3,000通しかない。
   ========================================================================== */

/** 文面を組み立てるのに要るもの。行そのものではなく、読める形にしたもの。 */
export type PendingNotification = {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly organizationName: string;
  readonly slug: string;
  readonly projectKey: string;
  readonly number: number;
  readonly title: string;
  readonly actorName: string | null;
  readonly commentId: string | null;
  /** 消されたコメントは null で来る。消えた文章をメールで配り直さない。 */
  readonly commentBody: string | null;
};

/** 引用する本文の行数と長さ。読んだ時点で用が済まない程度に留める。 */
const EXCERPT_LINES = 4;
const EXCERPT_CHARS = 200;

function who(row: PendingNotification): string {
  return row.actorName ?? '退会した人';
}

/** 誰が何をしたか。ウォッチの通知だけは、誰がやったかを主語にしない。 */
function headline(row: PendingNotification): string {
  switch (row.kind) {
    case 'mention':
      return `${who(row)} さんがあなたをメンションしました`;
    case 'assigned':
      return `${who(row)} さんがあなたを担当者に設定しました`;
    case 'comment':
      return 'ウォッチ中のスレッドに新しいコメントがあります';
  }
}

function url(origin: string, row: PendingNotification): string {
  const path = threadPath(
    row.slug,
    row.projectKey,
    row.number,
    row.commentId === null ? {} : { commentId: row.commentId },
  );
  return `${origin}${path}`;
}

/**
 * コメントの冒頭。
 *
 * 全部載せると、メールを読んだ時点で用が済む。
 * スレッドに返事が戻らなくなり、決まったことがメールの中だけに残る。
 */
function excerpt(body: string): string[] {
  const lines = body.trimEnd().split('\n');
  const head = lines.slice(0, EXCERPT_LINES);
  let quoted = head.join('\n');
  let trimmed = lines.length > EXCERPT_LINES;

  if (quoted.length > EXCERPT_CHARS) {
    quoted = quoted.slice(0, EXCERPT_CHARS);
    trimmed = true;
  }

  const out = quoted.split('\n').map((line) => (line === '' ? '>' : `> ${line}`));
  if (trimmed) {
    out.push('> …');
  }
  return out;
}

/**
 * 末尾。
 *
 * 止め方をここに書く。煩わしいと感じた人はメールの上で判断するので、
 * アプリの中にしか切り替えが無いと、迷惑メールの押しボタンのほうが近い。
 * 報告が積み重なると送信ドメインの評価が下がり、
 * 最後にはマジックリンクが届かなくなる。
 */
function footer(origin: string): string[] {
  return ['--', 'このメールには返信できません。', `通知メールを止める: ${origin}/me`];
}

function single(row: PendingNotification, origin: string): Mail {
  const label = threadLabel(row.projectKey, row.number);
  const lines = [
    row.kind === 'comment'
      ? `${label} に新しいコメントがあります。`
      : `${who(row)} さんが ${label} で${row.kind === 'mention' ? 'あなたをメンションしました' : 'あなたを担当者に設定しました'}。`,
    '',
    `${label} ${row.title}`,
  ];

  if (row.commentBody !== null) {
    lines.push('', ...excerpt(row.commentBody));
  }

  lines.push('', url(origin, row), '', ...footer(origin));

  return { to: '', subject: `[${label}] ${row.title}`, text: lines.join('\n') };
}

function digest(rows: readonly PendingNotification[], origin: string): Mail {
  // 組織をまたいで届くことがある。またぐときだけ、どこの話かを添える。
  const organizations = [...new Set(rows.map((row) => row.organizationName))];
  const lines = [`TASK3 に ${rows.length} 件の通知があります。`];

  let current: string | null = null;
  for (const row of rows) {
    if (organizations.length > 1 && row.organizationName !== current) {
      current = row.organizationName;
      lines.push('', `【${current}】`);
    }
    lines.push(
      '',
      headline(row),
      `${threadLabel(row.projectKey, row.number)} ${row.title}`,
      url(origin, row),
    );
  }

  lines.push('', ...footer(origin));

  return {
    to: '',
    subject: `TASK3 に ${rows.length} 件の通知があります`,
    text: lines.join('\n'),
  };
}

/**
 * 一人ぶんの通知を一通にする。
 *
 * 一件のときだけコメントの冒頭を載せる。
 * まとめたときに全部の本文を並べると、長さが件数に比例して伸びる。
 */
export function composeNotificationMail(
  to: string,
  rows: readonly PendingNotification[],
  origin: string,
): Mail {
  if (rows.length === 0) {
    throw new Error('通知が一件もありません');
  }
  const first = rows[0];
  if (rows.length === 1 && first) {
    return { ...single(first, origin), to };
  }
  return { ...digest(rows, origin), to };
}
