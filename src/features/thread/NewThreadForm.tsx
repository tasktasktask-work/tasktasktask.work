'use client';

import { useActionState, useState } from 'react';
import { createThreadAction, type ThreadActionState } from './actions.ts';
import type { ThreadType } from './queries.ts';

const empty: ThreadActionState = {};

/*
 * スレッドを立てる。
 *
 * 一覧の上に畳んで置かず、専用の画面にしてある。
 * 本文を書く場所が要るためで、数行の入力欄に押し込むと
 * 「あとで本文を足す」前提の空のスレッドが並ぶ。
 *
 * 種別は後から変えられない。
 * 議論として立てたものを課題に作り変えることはできず、
 * 課題を別に立てて、議論を親にすることになる。
 */
export function NewThreadForm({
  slug,
  projectKey,
  members,
  defaultType,
  defaultParent,
}: {
  slug: string;
  projectKey: string;
  members: { userId: string; displayName: string }[];
  defaultType: ThreadType;
  defaultParent: string;
}) {
  const [state, action, saving] = useActionState(createThreadAction, empty);
  const [type, setType] = useState<ThreadType>(defaultType);

  return (
    <form className="app-form" action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}

      <div className="line">
        <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 11rem' }}>
          <label htmlFor="thread-type">種別</label>
          <select
            id="thread-type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as ThreadType)}
          >
            <option value="kadai">課題</option>
            <option value="giron">議論</option>
            <option value="shitsumon">質問</option>
          </select>
        </div>
        <div className="auth-field" style={{ marginBottom: 0 }}>
          <label htmlFor="thread-title">タイトル</label>
          <input id="thread-title" name="title" type="text" required />
        </div>
      </div>

      <p className="app-hint">
        種別はあとから変えられません。議論からその場で課題を作りたくなったら、
        課題を別に立てて、この議論を親にしてください。
      </p>

      <div className="auth-field" style={{ marginTop: '.9rem' }}>
        <label htmlFor="thread-body">本文</label>
        <textarea
          id="thread-body"
          name="body"
          rows={10}
          placeholder="何をするのか、何が決まっていないのかを書きます。"
        />
      </div>

      <div className="line">
        <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 12rem' }}>
          <label htmlFor="thread-parent">親スレッド</label>
          <input
            id="thread-parent"
            name="parent"
            type="text"
            defaultValue={defaultParent}
            placeholder={`${projectKey}-3`}
          />
        </div>
        <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 14rem' }}>
          <label htmlFor="thread-assignee">担当者</label>
          <select id="thread-assignee" name="assignee" defaultValue="">
            <option value="">未設定</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 期間を持てるのは課題だけである。持てない種別では欄ごと消す */}
      {type === 'kadai' ? (
        <div className="line" style={{ marginTop: '.7rem' }}>
          <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 12rem' }}>
            <label htmlFor="thread-starts">開始日</label>
            <input id="thread-starts" name="startsOn" type="date" />
          </div>
          <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 12rem' }}>
            <label htmlFor="thread-ends">終了日</label>
            <input id="thread-ends" name="endsOn" type="date" />
          </div>
          <span style={{ flex: 1 }} />
        </div>
      ) : null}

      {type === 'kadai' ? (
        <p className="app-hint">
          両方入れるか、両方空けるかのどちらかです。片方だけだと、
          ガントに置けるのか置けないのかが決まりません。
        </p>
      ) : null}

      <div className="line" style={{ marginTop: '1rem' }}>
        <span style={{ flex: 1 }} />
        <button className="app-btn" type="submit" disabled={saving}>
          {saving ? '作成中…' : 'この内容で立てる'}
        </button>
      </div>
    </form>
  );
}
