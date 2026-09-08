'use client';

import { useActionState } from 'react';
import { type AccountActionState, setEmailNotificationsAction } from './actions.ts';

/*
 * 通知メールの入り切り。
 *
 * 押しボタンひとつにしてある。チェックと保存に分けると、
 * 切ったつもりで保存を押していない状態が作れる。
 * 止めたい人は、たいてい届いた直後に苛立って開いている。
 */

const empty: AccountActionState = {};

export function EmailNotificationsForm({ enabled }: { enabled: boolean }) {
  const [state, action, saving] = useActionState(setEmailNotificationsAction, empty);

  return (
    <form action={action}>
      <input type="hidden" name="enabled" value={enabled ? 'off' : 'on'} />
      <button className={enabled ? 'app-btn' : 'app-btn ghost'} type="submit" disabled={saving}>
        {enabled ? '受け取っています' : '止まっています'}
      </button>
      {state.notice ? <span className="ok">{state.notice}</span> : null}
      {state.error ? <span className="err">{state.error}</span> : null}
    </form>
  );
}
