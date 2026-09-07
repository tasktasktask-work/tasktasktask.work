import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyze,
  type Candidate,
  findMentions,
  findTasks,
  prepare,
  toggleTask,
} from '#lib/markdown.ts';

/*
 * 本文の下ごしらえ。
 *
 * データベースを使わない。ここで固定するのは文字列の走査だけである。
 *
 * 落ちると何が起きるかを先に書いておく。
 * コードの中を拾えば、コード例の中の `- [ ]` がチェックボックスになって
 * 表示が壊れる。番号がずれれば、別の箱のチェックが入る。
 * `<mention>` を通せば、他人を指名したように見せかける文章が書ける。
 */

const people: Candidate[] = [
  { userId: 'u-sato', displayName: '佐藤 明日香' },
  { userId: 'u-sato2', displayName: '佐藤 明日香' },
  { userId: 'u-tanaka', displayName: '田中 亮' },
  { userId: 'u-sa', displayName: '佐藤' },
];

describe('チェックボックスを拾う', () => {
  it('箇条書きの先頭にあるものを順に拾う', () => {
    const tasks = findTasks('- [ ] ひとつめ\n- [x] ふたつめ\n- [ ] みっつめ');
    assert.equal(tasks.length, 3);
    assert.deepEqual(
      tasks.map((t) => [t.position, t.checked]),
      [
        [0, false],
        [1, true],
        [2, false],
      ],
    );
  });

  it('位置は記法そのものを指す', () => {
    const source = '- [x] やること';
    const item = findTasks(source)[0];
    assert.ok(item);
    assert.equal(source.slice(item.start, item.end), '[x]');
  });

  it('大文字の X も入っているとみなす', () => {
    assert.equal(findTasks('- [X] おおもじ')[0]?.checked, true);
  });

  it('番号付きの箇条書きでも拾う', () => {
    assert.equal(findTasks('1. [ ] ひとつめ\n2. [x] ふたつめ').length, 2);
  });

  it('入れ子になったものも拾う', () => {
    const tasks = findTasks('- [ ] おや\n    - [x] こ\n        - [ ] まご');
    assert.equal(tasks.length, 3);
  });

  it('囲まれたコードの中は拾わない', () => {
    const source = ['- [ ] ほんもの', '', '```', '- [ ] これはコード', '```'].join('\n');
    const tasks = findTasks(source);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.position, 0);
  });

  it('チルダの囲みでも拾わない', () => {
    assert.equal(findTasks('~~~\n- [ ] コード\n~~~').length, 0);
  });

  it('囲みが閉じていなければ、そこから先はすべてコードとみなす', () => {
    assert.equal(findTasks('```\n- [ ] とじていない').length, 0);
  });

  it('コードの囲みが終われば、また拾う', () => {
    const source = ['```', '- [ ] なか', '```', '- [ ] そと'].join('\n');
    const tasks = findTasks(source);
    assert.equal(tasks.length, 1);
    assert.ok(source.slice(tasks[0]?.start).startsWith('[ ] そと'));
  });

  it('段落の後の深い字下げはコードブロックとみなす', () => {
    // 箇条書きの直後ではないので、半角4つの字下げはコードである
    assert.equal(findTasks('ふつうの段落\n\n    - [ ] コードブロック').length, 0);
  });

  it('行をまたぐインラインコードに覆われたものは拾わない', () => {
    /*
     * GFM の本来の解釈では、段落の途中で開いたバッククォートが
     * 次の箇条書きまで届くことはない。ここではそれより広く覆っている。
     * 広すぎたときに起きるのは「押せないチェックボックスが出る」ことで、
     * 狭すぎたときに起きるのは「コードの中の記法が押せてしまう」ことである。
     * 後者のほうが害が大きいので、広いほうへ倒してある。
     */
    assert.equal(findTasks('文章 `まだ閉じない\n- [ ] これは拾わない\n` 閉じた').length, 0);
  });

  it('記法の後ろに文字が続くものは拾わない', () => {
    assert.equal(findTasks('- [x]すぐ文字').length, 0);
  });

  it('箇条書きでない行は拾わない', () => {
    assert.equal(findTasks('[ ] ただの文章').length, 0);
  });
});

describe('コードの範囲', () => {
  it('インラインコードの中を印す', () => {
    const source = 'これは `@佐藤 明日香` です';
    const { mask } = analyze(source);
    assert.equal(mask[source.indexOf('@')], 1);
    assert.equal(mask[0], 0);
  });

  it('閉じないバッククォートは、ただの文字として扱う', () => {
    const source = '` @佐藤 明日香';
    assert.equal(analyze(source).mask[source.indexOf('@')], 0);
  });

  it('バッククォートの数が合わないと閉じない', () => {
    const source = '``@佐藤 明日香`';
    assert.equal(analyze(source).mask[source.indexOf('@')], 0);
  });
});

describe('メンションを解決する', () => {
  it('最長一致で拾う', () => {
    const source = '@佐藤 明日香 さん';
    const [found] = findMentions(source, people);
    assert.ok(found);
    assert.equal(source.slice(found.start, found.end), '@佐藤 明日香');
  });

  it('短いほうの名前しか合わなければ、そちらを採る', () => {
    const source = '@佐藤 さん';
    const [found] = findMentions(source, people);
    assert.equal(source.slice(found?.start ?? 0, found?.end ?? 0), '@佐藤');
  });

  it('同姓同名は全員を指名とみなす', () => {
    const [found] = findMentions('@佐藤 明日香 さん', people);
    assert.deepEqual([...(found?.userIds ?? [])].sort(), ['u-sato', 'u-sato2']);
  });

  it('候補にない名前は拾わない', () => {
    assert.equal(findMentions('@山田 太郎 さん', people).length, 0);
  });

  it('メールアドレスは指名ではない', () => {
    assert.equal(findMentions('sato@佐藤 明日香', people).length, 0);
  });

  it('コードの中は拾わない', () => {
    assert.equal(findMentions('`@佐藤 明日香`', people).length, 0);
    assert.equal(findMentions('```\n@佐藤 明日香\n```', people).length, 0);
  });

  it('一つの本文に複数あってもすべて拾う', () => {
    const found = findMentions('@佐藤 明日香 と @田中 亮 へ', people);
    assert.equal(found.length, 2);
    assert.deepEqual(found[1]?.userIds, ['u-tanaka']);
  });

  it('候補がいなければ何も拾わない', () => {
    assert.equal(findMentions('@佐藤 明日香', []).length, 0);
  });
});

describe('チェックを差し替える', () => {
  it('番号で指した箱だけを変える', () => {
    const source = '- [ ] ひとつめ\n- [ ] ふたつめ';
    assert.equal(toggleTask(source, 1, true), '- [ ] ひとつめ\n- [x] ふたつめ');
  });

  it('外すこともできる', () => {
    assert.equal(toggleTask('- [x] やった', 0, false), '- [ ] やった');
  });

  it('無い番号を指されたら null', () => {
    assert.equal(toggleTask('- [ ] ひとつだけ', 3, true), null);
  });

  it('他の箱と本文は一字も変えない', () => {
    const source = '見出し\n\n- [x] A\n- [ ] B\n\n```\n- [ ] コード\n```\n';
    const after = toggleTask(source, 1, true);
    assert.ok(after);
    assert.equal(after.replace('- [x] B', '- [ ] B'), source);
  });
});

describe('streamdown に渡す形にする', () => {
  it('チェックボックスをタグに置き換える', () => {
    const out = prepare('- [ ] やること', { checked: () => false });
    assert.equal(out, '- <task i="0" state="off"></task> やること');
  });

  it('状態は渡された関数が決める', () => {
    const out = prepare('- [ ] A\n- [ ] B', { checked: (item) => item.position === 1 });
    assert.ok(out.includes('<task i="0" state="off">'));
    assert.ok(out.includes('<task i="1" state="on">'));
  });

  it('本文の記法と食い違っていても、渡された状態を採る', () => {
    // コメントの状態は別のテーブルにある。本文の [x] は投稿時のままである
    const out = prepare('- [x] やること', { checked: () => false });
    assert.ok(out.includes('state="off"'));
  });

  it('メンションを包む', () => {
    const source = '@田中 亮 へ';
    const out = prepare(source, { mentions: findMentions(source, people) });
    assert.equal(out, '<mention>@田中 亮</mention> へ');
  });

  it('両方あっても位置がずれない', () => {
    const source = '- [ ] @田中 亮 に聞く\n- [x] おわり';
    const out = prepare(source, {
      mentions: findMentions(source, people),
      checked: (item) => item.position === 1,
    });
    assert.equal(
      out,
      '- <task i="0" state="off"></task> <mention>@田中 亮</mention> に聞く\n' +
        '- <task i="1" state="on"></task> おわり',
    );
  });

  it('利用者が書いたタグは効かない', () => {
    const out = prepare('<mention>@佐藤 明日香</mention> と書いてみる', {});
    // 開きのカッコだけを潰せば、タグとしては死ぬ
    assert.equal(out, '&lt;mention>@佐藤 明日香&lt;/mention> と書いてみる');
  });

  it('閉じるほうのタグも無効にする', () => {
    assert.equal(prepare('</task>', {}), '&lt;/task>');
  });

  it('コードの中に書かれたタグは、そのまま残す', () => {
    const out = prepare('`<mention>`', {});
    assert.equal(out, '`<mention>`');
  });

  it('他のHTMLには触らない。無害化は streamdown の仕事である', () => {
    assert.equal(prepare('<b>太字</b>', {}), '<b>太字</b>');
  });

  it('表示名に記号が入っていても壊れない', () => {
    const source = '@a<b>c さん';
    const out = prepare(source, {
      mentions: findMentions(source, [{ userId: 'u1', displayName: 'a<b>c' }]),
    });
    assert.equal(out, '<mention>@a&lt;b&gt;c</mention> さん');
  });

  it('何も指定しなければ、本文はそのまま出る', () => {
    const source = '- [ ] やること\n\n@佐藤 明日香';
    assert.equal(prepare(source, {}), source);
  });
});
