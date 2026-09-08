import sharp from 'sharp';

/* ==========================================================================
   画像を作り直す

   形式のホワイトリストは持たない。デコーダそのものが判定器である。
   読めたものだけを画像として扱い、読めなかったものは
   ダウンロードできるだけの添付になる。

   検査して通すのではなく、作り直して安全なものだけを出力する。
   維持すべきリストがどこにも存在しない。
   副産物として、ポリグロットも Exif の位置情報も構造的に消える。
   スクリプトを埋めた SVG を渡されても、出てくるのはラスタの PNG である。

   保存するのはこの出力だけで、原本は残さない。
   位置情報が消えたと思っている人の期待を、保存の側で裏切らないためである。
   ========================================================================== */

export type Reencoded = {
  readonly bytes: Buffer;
  /** 保存先のキーに付ける。配信の Content-Type はここから決まる */
  readonly extension: 'png' | 'jpg';
};

/**
 * 画像として読み直し、書き出し直す。読めなければ null を返す。
 *
 * 出力は二種類だけである。透明を持つものは PNG、持たないものは JPEG になる。
 * 読めた形式のまま書き戻す形にすると、出力形式の数だけ経路が増え、
 * そのどれもが「作り直した安全な出力」であることを個別に確かめる対象になる。
 *
 * 長辺は縮めない。残るのはこの一枚だけなので、縮めた分は取り戻せない。
 * 貼られる画像の大半はスクリーンショットで、要件は文字が読めることである。
 *
 * アニメーションは保たない。GIF は一枚目だけの静止画になる。
 */
export async function reencode(input: Buffer): Promise<Reencoded | null> {
  try {
    // rotate() は Exif の向きを画素の側へ畳み込む。
    // メタデータを捨てるので、これをやらないと横倒しのまま残る。
    const image = sharp(input).rotate();
    const meta = await image.metadata();

    const bytes = meta.hasAlpha
      ? await image.png().toBuffer()
      : await image.jpeg({ quality: 85 }).toBuffer();

    return { bytes, extension: meta.hasAlpha ? 'png' : 'jpg' };
  } catch {
    // 画像でないもの、壊れたもの、展開すると巨大になるものがここへ来る。
    // どれも「画像ではない」として同じに扱う。区別しても行き先が同じである。
    return null;
  }
}

/**
 * 配信のときの Content-Type。
 *
 * 保存先のキーから決める。キーは生成した値なので、
 * 利用者由来の文字列がヘッダに回り込む経路がここに無い。
 */
export function contentTypeFor(storageKey: string): string {
  return storageKey.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/**
 * 表示用の名前の拡張子を、書き出した形式に合わせる。
 *
 * `shot.gif` を貼ると中身は PNG になるので、名前をそのままにすると
 * ダウンロードした先で開けないファイルを渡すことになる。
 * 触るのは末尾だけで、名前の本体は変えない。
 */
export function withExtension(filename: string, extension: string): string {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return `${stem}.${extension}`;
}
