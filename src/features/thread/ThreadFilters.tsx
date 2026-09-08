/*
 * 一覧の絞り込み。
 *
 * 全文検索を持たないので、ここが探すための唯一の手段になる。
 * 選んだ状態が URL に残る形にしてあるのは、絞り込んだ結果を
 * そのまま人に渡せるようにするためである。
 *
 * JavaScript を使わない。選んで押せば画面が引き直る。
 * 状態を持たせると、戻るボタンで押した内容と表示がずれる。
 */

export type ThreadQuery = {
  type?: string;
  assignee?: string;
  tag?: string;
  completed?: string;
  archived?: string;
};

export function ThreadFilters({
  members,
  tags,
  query,
}: {
  members: { userId: string; displayName: string }[];
  /*
   * このプロジェクトで実際に使われているタグだけ。
   * 組織の全タグを並べると、別のプロジェクト専用のタグが混ざり、
   * 選んでも常に 0 件になる選択肢が並ぶ。
   */
  tags: { id: string; name: string }[];
  query: ThreadQuery;
}) {
  return (
    <form className="app-filters" method="get">
      <select name="type" defaultValue={query.type ?? ''} aria-label="種別で絞り込む">
        <option value="">種別 すべて</option>
        <option value="kadai">課題</option>
        <option value="giron">議論</option>
        <option value="shitsumon">質問</option>
      </select>

      <select name="assignee" defaultValue={query.assignee ?? ''} aria-label="担当者で絞り込む">
        <option value="">担当者 すべて</option>
        <option value="none">未設定</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.displayName}
          </option>
        ))}
      </select>

      {/* 一つも使われていないプロジェクトでは、欄そのものを出さない */}
      {tags.length > 0 ? (
        <select name="tag" defaultValue={query.tag ?? ''} aria-label="タグで絞り込む">
          <option value="">タグ すべて</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      ) : null}

      <label>
        <input
          type="checkbox"
          name="completed"
          value="1"
          defaultChecked={query.completed === '1'}
        />{' '}
        完了も表示
      </label>
      <label>
        <input
          type="checkbox"
          name="archived"
          value="1"
          defaultChecked={query.archived === '1'}
        />{' '}
        アーカイブ済みも表示
      </label>

      <button className="app-btn ghost" type="submit">
        絞り込む
      </button>

      <span className="sp" />
      <span
        style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: '.7rem' }}
      >
        更新の新しい順
      </span>
    </form>
  );
}
