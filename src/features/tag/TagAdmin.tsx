'use client';

import { useActionState } from 'react';
import { Told, useField } from '#lib/field.tsx';
import {
  createTagAction,
  deleteTagAction,
  type TagActionState,
  updateTagAction,
} from './actions.ts';
import { DEFAULT_TAG_COLOR, NAME_MAX, TAG_COLORS } from './colors.ts';
import type { TagAdminRow } from './queries.ts';
import { ColorSwatches } from './TagChip.tsx';

/*
 * タグの管理画面。誰でも入れて、誰でも作れる。
 *
 * 組織の設定の中に置かなかったのは、あの画面が組織管理者以外に
 * 404 を返すためである。置いた時点で「タグは管理者のもの」になる。
 *
 * 行の中で直す。タグは名前と色しか持たないので、そのために画面を移らせない。
 */

const empty: TagActionState = {};

export function NewTagForm({ slug }: { slug: string }) {
  const [state, action, saving] = useActionState(createTagAction, empty);

  return (
    <form className="app-form" action={action}>
      <div className="line">
        <input type="hidden" name="slug" value={slug} />
        <input
          type="text"
          name="name"
          required
          maxLength={NAME_MAX}
          placeholder="タグの名前"
          aria-label="新しいタグの名前"
          style={{ width: '12rem' }}
        />
        <ColorSwatches colors={TAG_COLORS} name="color" selected={DEFAULT_TAG_COLOR} />
        <button className="app-btn" type="submit" disabled={saving}>
          作る
        </button>
        {state.error ? <span className="err">{state.error}</span> : null}
        {state.notice ? <span className="ok">{state.notice}</span> : null}
      </div>
    </form>
  );
}

export function TagRowForms({ slug, tag }: { slug: string; tag: TagAdminRow }) {
  const [save, saveAction, saving] = useActionState(updateTagAction, empty);
  const [name, setName, settled] = useField(tag.name);
  const [drop, dropAction, dropping] = useActionState(deleteTagAction, empty);

  return (
    <div className="app-person p-tag-admin">
      <form className="nm" action={saveAction}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="tagId" value={tag.id} />
        <input
          type="text"
          name="name"
          required
          maxLength={NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={`${tag.name} の名前`}
        />
        <ColorSwatches colors={TAG_COLORS} name="color" selected={tag.color} />
        <button className="app-btn ghost" type="submit" disabled={saving}>
          保存
        </button>
        <Told state={save} settled={settled} />
      </form>

      <span className="sp" style={{ flex: 1 }} />
      <span className="use">{tag.usage}件</span>

      {/*
       * 一度目は何件から外れるかを返すだけで、二度目に消える。
       * 結びごと消すので取り消しが効かない。
       * 確認の窓は押し慣れると読まれなくなるが、押しボタンの文言が
       * 変わるなら、押した手のほうが「変わった」ことに気づく。
       */}
      <form action={dropAction}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="tagId" value={tag.id} />
        <input type="hidden" name="confirm" value={drop.confirming ? '1' : ''} />
        <button className="app-btn ghost" type="submit" disabled={dropping}>
          {drop.confirming ? '本当に消す' : '消す'}
        </button>
      </form>

      {save.error ? <span className="note">{save.error}</span> : null}
      {drop.error ? <span className="note">{drop.error}</span> : null}
      {drop.notice ? <span className="note">{drop.notice}</span> : null}
    </div>
  );
}
