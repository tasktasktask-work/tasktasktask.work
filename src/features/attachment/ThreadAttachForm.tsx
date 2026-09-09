'use client';

import { type DragEvent, useActionState, useEffect, useRef, useState } from 'react';
import { type AttachmentActionState, attachToThreadAction } from './actions.ts';
import { BATCH_MAX, FILE_FIELD, FILE_MAX, formatBytes } from './limits.ts';
import { putBack, shrink, tooLarge } from './shrink.ts';

/* ==========================================================================
   本文に添付を足す欄

   スレッドを立てる画面には置いていない。
   立てる処理は親子と期間とタグを一つの取引で検査するので、
   そこへ 30MB の書き込みを足すと、失敗したときに
   ファイルの選び直しまで巻き込むことになる。

   押しボタンが無い。選んだ時点で、あるいは落とした時点で送る。
   二段目の「添付する」は、押し忘れたときにだけ意味を持つ押しボタンだった。
   ところが押し忘れたことは画面から分からないので、意味を持つ場面が来ない。
   間違えて付けたものは、一覧の側から一押しで消せる。

   受け皿はこの欄の中だけである。
   本文列まで広げると、本文の文字を選んで動かしたときに紛れる。

   JavaScript が動かないときは、noscript の押しボタンが受ける。
   ここだけ JavaScript 必須にすると、送信の経路を一本に決めた判断が崩れる。
   ========================================================================== */

const empty: AttachmentActionState = {};

export function ThreadAttachForm({
  slug,
  projectKey,
  number,
}: {
  slug: string;
  projectKey: string;
  number: number;
}) {
  const [state, action, sending] = useActionState(attachToThreadAction, empty);
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const wasSending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  // 送り終わったら欄を空へ戻す。同じものを二度送らせない
  useEffect(() => {
    if (wasSending.current && !sending && field.current) {
      field.current.value = '';
    }
    wasSending.current = sending;
  }, [sending]);

  const working = busy || sending;

  /*
   * 断ったら、選んだものを欄から捨てる。
   * 押しボタンが無いので、直してもう一度押す機会がない。
   * 残しても送る手段がないものを、選択済みとして見せ続けない。
   */
  const refuse = (message: string) => {
    setError(message);
    if (field.current) {
      field.current.value = '';
    }
  };

  const send = async (files: readonly File[]) => {
    const input = field.current;
    if (!input || files.length === 0 || working) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const ready: File[] = [];
      for (const file of files) {
        ready.push(await shrink(file));
      }

      const problem = tooLarge(ready);
      if (problem) {
        refuse(problem);
        return;
      }

      // 縮めた結果を欄へ戻してから送る。欄は開いたまま置いておく。
      // 送っているあいだに外すと、フォームからファイルが消える
      putBack(input, ready);
      form.current?.requestSubmit();
    } catch {
      refuse('ファイルを読めませんでした');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    void send([...event.dataTransfer.files]);
  };

  return (
    <form className="p-attach-drop" action={action} ref={form}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="number" value={number} />

      {/* biome-ignore lint/a11y/noStaticElementInteractions: 落とす受け皿。押す操作は中の欄が持つ */}
      <div
        className="zone"
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {working ? (
          <span className="busy">{busy ? '画像を縮めています…' : '送っています…'}</span>
        ) : (
          'ここへ落とすか、ファイルを選んでください'
        )}
        <input
          ref={field}
          type="file"
          name={FILE_FIELD}
          multiple
          aria-label="添付するファイル"
          onChange={(event) => void send([...(event.target.files ?? [])])}
        />
      </div>

      {error ? <p className="err">{error}</p> : null}
      {!error && state.error ? <p className="err">{state.error}</p> : null}
      {!error && !state.error && !working && state.notice ? (
        <p className="ok">{state.notice}</p>
      ) : null}

      <p className="note">
        1ファイル {formatBytes(FILE_MAX)}、一度に合計 {formatBytes(BATCH_MAX)}{' '}
        まで。形式は問いません
      </p>

      <noscript>
        <button className="app-btn ghost" type="submit">
          添付する
        </button>
      </noscript>
    </form>
  );
}
