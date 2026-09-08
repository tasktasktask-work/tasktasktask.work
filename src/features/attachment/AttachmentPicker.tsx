'use client';

import { useRef, useState } from 'react';
import { BATCH_MAX, FILE_FIELD, FILE_MAX, formatBytes } from './limits.ts';

/* ==========================================================================
   ファイルを選ぶ欄

   JavaScript が動かなくても、素のファイル入力として送られる。
   そのときに増えるのは「大きすぎるものが上りきってから断られる」ことだけで、
   断る判定そのものはサーバー側にある。

   動くときにやることは二つある。
   10MB を超えた写真を品質だけ落として収めることと、
   収まらないものを送る前に止めることである。

   長辺は縮めない。サーバー側で縮めないと決めたのと同じ理由で、
   ここで縮めると、その一枚は二度と原寸に戻らない。
   PNG は触らない。スクリーンショットの文字が潰れると添付の用をなさなくなる。
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

      const tooBig = ready.find((file) => file.size > FILE_MAX);
      if (tooBig) {
        block(`${tooBig.name} は ${formatBytes(FILE_MAX)} に収まりません`);
      } else if (ready.reduce((sum, file) => sum + file.size, 0) > BATCH_MAX) {
        block(`一度に送れるのは合計 ${formatBytes(BATCH_MAX)} までです`);
      }

      // 縮めた結果を欄に戻す。ここを通ったものがそのまま送られる
      const box = new DataTransfer();
      for (const file of ready) {
        box.items.add(file);
      }
      input.files = box.files;
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

/**
 * 大きすぎる写真を、品質だけ落として上限に収める。
 *
 * 触るのは上限を超えた画像だけである。常に縮めると、
 * 1MB の写真も劣化させて、得るのは上りの数百ミリ秒になる。
 *
 * ライブラリは選んだときだけ読み込む。
 * 添付を使わない人の画面に、この重さを持ち込まない。
 */
async function shrink(file: File): Promise<File> {
  if (file.size <= FILE_MAX || !file.type.startsWith('image/') || file.type === 'image/png') {
    return file;
  }

  const { default: compress } = await import('browser-image-compression');
  try {
    return await compress(file, {
      maxSizeMB: FILE_MAX / (1024 * 1024),
      // 長辺は変えない。既定では 1920px に縮められる
      maxWidthOrHeight: Number.MAX_SAFE_INTEGER,
      useWebWorker: true,
      // Exif の向きを画素へ畳み込む。横倒しのまま送らないため
      preserveExif: false,
    });
  } catch {
    // 読めなかったものは、そのままサーバーへ送って断らせる
    return file;
  }
}
