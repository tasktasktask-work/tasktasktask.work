'use client';

import { useActionState } from 'react';
import { createProjectAction, type ProjectActionState } from './actions.ts';

const empty: ProjectActionState = {};

/*
 * プロジェクトを作る。
 *
 * 開いたときに閉じているのは、この画面の主役が一覧だからである。
 * 作るのは組織管理者だけで、しかも何度も行う操作ではない。
 */
export function NewProjectForm({ slug }: { slug: string }) {
  const [state, action, saving] = useActionState(createProjectAction, empty);

  return (
    <details className="app-disclosure" open={Boolean(state.error)}>
      <summary>新しいプロジェクト</summary>

      <form className="app-form" action={action}>
        <input type="hidden" name="slug" value={slug} />

        {state.error ? <div className="app-note warn">{state.error}</div> : null}

        <div className="line">
          <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 10rem' }}>
            <label htmlFor="project-key">キー</label>
            <input
              id="project-key"
              name="key"
              type="text"
              maxLength={10}
              pattern="[A-Za-z0-9]{2,10}"
              placeholder="WEB"
              required
            />
          </div>
          <div className="auth-field" style={{ marginBottom: 0 }}>
            <label htmlFor="project-name">プロジェクト名</label>
            <input id="project-name" name="name" type="text" required />
          </div>
        </div>

        <p className="app-hint">
          キーはスレッド識別子の前半になります（<code>WEB-128</code>）。
          あとから変えられません。
        </p>

        <div className="line" style={{ marginTop: '.7rem' }}>
          <div className="auth-field" style={{ marginBottom: 0 }}>
            <label htmlFor="project-description">説明</label>
            <input id="project-description" name="description" type="text" />
          </div>
          <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 12rem' }}>
            <label htmlFor="project-visibility">公開設定</label>
            <select id="project-visibility" name="visibility" defaultValue="public">
              <option value="public">公開（組織の全員）</option>
              <option value="private">非公開（メンバーだけ）</option>
            </select>
          </div>
          <button className="app-btn" type="submit" disabled={saving}>
            {saving ? '作成中…' : '作成'}
          </button>
        </div>
      </form>
    </details>
  );
}
