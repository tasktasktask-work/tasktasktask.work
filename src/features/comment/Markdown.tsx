'use client';

import type { ReactNode } from 'react';
import { useState, useTransition } from 'react';
import { Streamdown } from 'streamdown';
import { setBodyCheckAction } from '#features/thread/actions.ts';
import { setCommentCheckAction } from './actions.ts';

/* ==========================================================================
   本文とコメントの描画

   Markdown の解釈と無害化は streamdown が行う。
   生の HTML は落とすのではなく、無害化を通したうえで出す。
   `<script>` は消え、`onerror` の付いた画像は差し止められ、
   `javascript:` のリンクは無効になる。

   このファイルが受け取るのは、すでに下ごしらえの済んだ文字列である
   （#lib/markdown.ts の prepare）。
   チェックボックスは `<task i state>` に、指名は `<mention>` に化けている。
   その二つだけを、こちらのコンポーネントに引き受ける。

   表とコードブロックに付いてくる操作ボタン（コピー、ダウンロード、全画面）は
   出さない。あれらの見た目は Tailwind のクラスで組まれていて、
   このプロジェクトには Tailwind が無いため、そのまま出すと崩れる。
   中身の体裁は data-streamdown 属性を手がかりに自前の CSS で当てている。
   ========================================================================== */

/** チェックボックスを押せる先。渡さなければ押せない見た目で出る。 */
export type CheckTarget =
  | {
      readonly kind: 'comment';
      readonly slug: string;
      readonly key: string;
      readonly number: number;
      readonly commentId: string;
    }
  | {
      readonly kind: 'body';
      readonly slug: string;
      readonly key: string;
      readonly number: number;
    };

const ALLOWED_TAGS: Record<string, string[]> = {
  task: ['i', 'state'],
  mention: [],
};

export function Markdown({
  source,
  target,
}: {
  source: string;
  target?: CheckTarget | undefined;
}) {
  return (
    <div className="app-md">
      <Streamdown
        mode="static"
        parseIncompleteMarkdown={false}
        controls={false}
        lineNumbers={false}
        allowedTags={ALLOWED_TAGS}
        literalTagContent={['mention']}
        components={{
          mention: (props) => <span className="p-mention">{props.children as ReactNode}</span>,
          task: (props) => (
            <TaskBox
              target={target}
              position={Number(props.i)}
              checked={props.state === 'on'}
            />
          ),
        }}
      >
        {source}
      </Streamdown>
    </div>
  );
}

/**
 * チェックボックス一つ。押した瞬間に送る。
 *
 * 見た目を先に変えてから送る。往復を待たせると、押したのに変わらない時間が
 * 目に見えるためである。断られたら戻して、理由をその場に出す。
 */
function TaskBox({
  target,
  position,
  checked,
}: {
  target: CheckTarget | undefined;
  position: number;
  checked: boolean;
}) {
  const [on, setOn] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  if (!target) {
    return <input type="checkbox" checked={checked} disabled readOnly aria-label="チェック" />;
  }

  return (
    <>
      <input
        type="checkbox"
        checked={on}
        disabled={saving}
        aria-label="チェック"
        onChange={(event) => {
          const next = event.currentTarget.checked;
          setOn(next);
          setError(null);
          startSaving(async () => {
            const result =
              target.kind === 'comment'
                ? await setCommentCheckAction({
                    slug: target.slug,
                    key: target.key,
                    number: target.number,
                    commentId: target.commentId,
                    position,
                    checked: next,
                  })
                : await setBodyCheckAction({
                    slug: target.slug,
                    key: target.key,
                    number: target.number,
                    position,
                    checked: next,
                  });
            if (result.error) {
              setOn(!next);
              setError(result.error);
            }
          });
        }}
      />
      {error ? <span className="p-check-error">{error}</span> : null}
    </>
  );
}
