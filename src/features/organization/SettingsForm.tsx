'use client';

import { useActionState } from 'react';
import { useField, withoutReset } from '#lib/field.tsx';
import { type OrgActionState, renameOrganizationAction } from './actions.ts';

const empty: OrgActionState = {};

export function SettingsForm({ slug, name }: { slug: string; name: string }) {
  const [state, action, saving] = useActionState(renameOrganizationAction, empty);
  const [value, setValue, settled] = useField(name);

  return (
    <form className="app-form" action={action} onSubmit={withoutReset(action)}>
      <input type="hidden" name="slug" value={slug} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      {state.notice && settled ? <div className="app-note ok">{state.notice}</div> : null}

      <div className="line">
        <div className="auth-field" style={{ marginBottom: 0 }}>
          <label htmlFor="org-name">組織名</label>
          <input
            id="org-name"
            name="name"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </div>
        <button className="app-btn" type="submit" disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}
