'use client';

import { useActionState } from 'react';
import { type NotificationActionState, setWatchAction } from './actions.ts';

/*
 * ウォッチの押しボタン。
 *
 * 自動では付かない。押して初めて付く。
 * 畳んだスレッドでも押せる。自分あての設定であって、書き込みではない。
 *
 * 誰がウォッチしているかは出さない。人数だけでも、
 * 少人数の組織では誰が見張っているかが割れる。
 */

const empty: NotificationActionState = {};

export function WatchForm({
  target,
  watching,
}: {
  target: { slug: string; projectKey: string; number: number };
  watching: boolean;
}) {
  const [state, action, saving] = useActionState(setWatchAction, empty);

  return (
    <form action={action}>
      <input type="hidden" name="slug" value={target.slug} />
      <input type="hidden" name="key" value={target.projectKey} />
      <input type="hidden" name="number" value={target.number} />
      <input type="hidden" name="watching" value={watching ? 'off' : 'on'} />
      <button
        className={watching ? 'app-btn' : 'app-btn ghost'}
        type="submit"
        disabled={saving}
      >
        {watching ? '👁 ウォッチ中' : 'ウォッチする'}
      </button>
      {state.error ? <span className="err">{state.error}</span> : null}
    </form>
  );
}
