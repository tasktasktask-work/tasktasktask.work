'use client';

import { useActionState } from 'react';
import { type BillingActionState, openPortalAction, startCheckoutAction } from './actions.ts';

const empty: BillingActionState = {};

/*
 * 決済代行の画面へ出る押しボタン。
 *
 * 押すと、その先はこのシステムの外である。
 * カード番号も住所も、こちらのフォームを通らない。
 */

export function RegisterButton({ slug, label }: { slug: string; label: string }) {
  const [state, action, sending] = useActionState(startCheckoutAction, empty);

  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} />
      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      <button className="app-btn" type="submit" disabled={sending}>
        {sending ? '進んでいます…' : label}
      </button>
    </form>
  );
}

export function PortalButton({ slug }: { slug: string }) {
  const [state, action, sending] = useActionState(openPortalAction, empty);

  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} />
      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      <button className="app-btn ghost" type="submit" disabled={sending}>
        {sending ? '進んでいます…' : 'カードと住所を変更する'}
      </button>
    </form>
  );
}
