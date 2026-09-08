'use client';

import { useActionState } from 'react';
import { Told, useField } from '#lib/field.tsx';
import {
  setAssigneeAction,
  setParentAction,
  setPeriodAction,
  setProgressAction,
  type ThreadActionState,
} from './actions.ts';

const empty: ThreadActionState = {};

/*
 * 右の属性欄。
 *
 * 進捗率、担当者、期間、親。この画面でだけ変えられる。
 * ガントのバーは引っぱれないので、期間を直すならここへ来ることになる。
 *
 * 欄ごとにフォームを分けてある。
 * ひとつにまとめると、担当者を変えたつもりが期間まで保存される。
 * 失敗したときの知らせも、どの欄のものか分からなくなる。
 */

type Target = { slug: string; projectKey: string; number: number };

function hidden({ slug, projectKey, number }: Target) {
  return (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="number" value={number} />
    </>
  );
}

/** 進捗率。課題は0から100、議論と質問はオープンとクローズだけ。 */
export function ProgressForm({
  target,
  progress,
  binary,
}: {
  target: Target;
  progress: number;
  binary: boolean;
}) {
  const [state, action, saving] = useActionState(setProgressAction, empty);
  const [value, setValue, settled] = useField(progress);

  if (binary) {
    const next = progress === 100 ? 0 : 100;
    return (
      <form action={action}>
        {hidden(target)}
        <input type="hidden" name="progress" value={next} />
        <span className="p-oc" data-oc={progress === 100 ? 'close' : 'open'}>
          {progress === 100 ? 'クローズ' : 'オープン'}
        </span>
        <button className="app-btn ghost" type="submit" disabled={saving}>
          {next === 100 ? 'クローズする' : '開け直す'}
        </button>
        {/* 押した結果は札そのものに出るので、揃っているかは見ない */}
        <Told state={state} settled={true} />
      </form>
    );
  }

  return (
    <form action={action}>
      {hidden(target)}
      <input
        type="number"
        name="progress"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        list="progress-values"
        aria-label="進捗率"
        style={{ width: '4.5rem' }}
      />
      {/* 1刻みで入れられるが、よく使う値は一手で選べるようにする */}
      <datalist id="progress-values">
        <option value="0" />
        <option value="25" />
        <option value="50" />
        <option value="75" />
        <option value="100" />
      </datalist>
      <span style={{ fontSize: '.78rem', color: 'var(--ink-soft)' }}>%</span>
      <button className="app-btn ghost" type="submit" disabled={saving}>
        保存
      </button>
      <Told state={state} settled={settled} />
    </form>
  );
}

export function AssigneeForm({
  target,
  assigneeUserId,
  members,
}: {
  target: Target;
  assigneeUserId: string | null;
  members: { userId: string; displayName: string }[];
}) {
  const [state, action, saving] = useActionState(setAssigneeAction, empty);
  const [value, setValue, settled] = useField(assigneeUserId ?? '');

  return (
    <form action={action}>
      {hidden(target)}
      <select
        name="assignee"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="担当者"
      >
        <option value="">未設定</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.displayName}
          </option>
        ))}
      </select>
      <button className="app-btn ghost" type="submit" disabled={saving}>
        変更
      </button>
      <Told state={state} settled={settled} />
    </form>
  );
}

/**
 * 期間。課題だけが持てる。
 *
 * 親からはみ出していても保存できる。
 * はみ出し警告は事実を伝えるだけで、直し方は人が決めるものだからである。
 * ここで弾くと、親の締切を延ばすまで子の日付を入れられなくなる。
 */
export function PeriodForm({
  target,
  startsOn,
  endsOn,
}: {
  target: Target;
  startsOn: string | null;
  endsOn: string | null;
}) {
  const [state, action, saving] = useActionState(setPeriodAction, empty);
  const [from, setFrom, fromSettled] = useField(startsOn ?? '');
  const [to, setTo, toSettled] = useField(endsOn ?? '');

  return (
    <form action={action}>
      {hidden(target)}
      <input
        type="date"
        name="startsOn"
        value={from}
        onChange={(event) => setFrom(event.target.value)}
        aria-label="開始日"
        style={{ width: '8.2rem' }}
      />
      <input
        type="date"
        name="endsOn"
        value={to}
        onChange={(event) => setTo(event.target.value)}
        aria-label="終了日"
        style={{ width: '8.2rem' }}
      />
      <button className="app-btn ghost" type="submit" disabled={saving}>
        保存
      </button>
      <Told state={state} settled={fromSettled && toSettled} />
    </form>
  );
}

/**
 * 親。番号で指す。
 *
 * 選択肢の一覧にしていないのは、プロジェクトのスレッドが数百件になると
 * 選べなくなるためである。親にしたいスレッドは、たいてい直前に見ている。
 */
export function ParentForm({
  target,
  parentNumber,
}: {
  target: Target;
  parentNumber: number | null;
}) {
  const [state, action, saving] = useActionState(setParentAction, empty);
  const [value, setValue, settled] = useField(
    parentNumber === null ? '' : `${target.projectKey}-${parentNumber}`,
  );

  return (
    <form action={action}>
      {hidden(target)}
      <input
        type="text"
        name="parent"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={`${target.projectKey}-3`}
        aria-label="親スレッド"
        style={{ width: '7rem' }}
      />
      <button className="app-btn ghost" type="submit" disabled={saving}>
        保存
      </button>
      <Told state={state} settled={settled} />
    </form>
  );
}
