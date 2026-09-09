'use client';

import { useRef, useState } from 'react';
import { FILE_FIELD, formatBytes } from './limits.ts';
import { putBack, shrink, tooLarge } from './shrink.ts';

/* ==========================================================================
   ファイルを選ぶ欄

   コメントの投稿欄で使う。
   コメントは本文と添付を一つの送信で出すので、選んだ時点では送れない。
   選んだ時点で送る形は、本文へ付けるときだけの ThreadAttachForm にある。

   JavaScript が動かなくても、素のファイル入力として送られる。
   そのときに増えるのは「大きすぎるものが上りきってから断られる」ことだけで、
   断る判定そのものはサーバー側にある。
   ========================================================================== */

type Chosen = { name: string; size: number };

export function AttachmentPicker({ hint }: { hint?: string }) {
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen[]>([]);

  /*
   * 送信そのものを止めるのに、ブラウザの検証を使う。
   * 押しボタンを disabled にする形だと、そのボタンが同じフォームの中に
   * あることを前提にしてしまう。この欄は本文の欄と並ぶ場所にも置く。
   */
  const block = (message: string | null) => {
    setError(message);
    field.current?.setCustomValidity(message ?? '');
  };

  const onChange = async () => {
    const input = field.current;
    if (!input?.files) {
      return;
    }

    const picked = [...input.files];
    if (picked.length === 0) {
      setChosen([]);
      block(null);
      return;
    }

    setBusy(true);
    block(null);

    try {
      const ready: File[] = [];
      for (const file of picked) {
        ready.push(await shrink(file));
      }

      block(tooLarge(ready));
      putBack(input, ready);
      setChosen(ready.map((file) => ({ name: file.name, size: file.size })));
    } catch {
      block('ファイルを読めませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-attach-pick">
      <input
        ref={field}
        type="file"
        name={FILE_FIELD}
        multiple
        aria-label="添付するファイル"
        onChange={() => void onChange()}
      />

      {busy ? <p className="note">画像を縮めています…</p> : null}
      {error ? <p className="err">{error}</p> : null}

      {!busy && !error && chosen.length > 0 ? (
        <ul className="picked">
          {chosen.map((file) => (
            <li key={`${file.name}:${file.size}`}>
              {file.name} <span className="size">{formatBytes(file.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {hint ? <p className="note">{hint}</p> : null}
    </div>
  );
}
