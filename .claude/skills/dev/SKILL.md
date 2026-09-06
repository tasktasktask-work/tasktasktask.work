---
name: dev
description: ソフトウェア開発を行うセッション。既存のドメインモデルと照らし合わせながら、曖昧さを残さず計画を徹底的に検証する。セッションごとの決定事項や全体方針（用語や設計方針）について即時ドキュメントへまとめていく。
---

<section title="何をすべきか">

  # 何をすべきか

  システム開発は機能ごとに以下の流れで進みます。

  1. 開発者への具体的な仕様の聞き取り
    - あなたと開発者が仕様について完全に共通の認識に達するまで、容赦無く聞き取りをしてください。
      これをデザインツリーとして捉えてください。すべての決定は、そこにぶら下がる決定へと枝分かれしていきます。
      - ツリーはラウンド単位で進めてください。
      - フロンティアとは、前提がすでに確定している決定すべてを指します。
        - まだ聞いていない答えを推測せずに今聞ける質問のことです。
        - フロンティア全体を1ラウンドでまとめて聞き取りをじてください。
        - 各質問には番号を振り、自分の推奨する答えを添えてください。そのうえで、次のラウンドに進む前にユーザーの回答を待ってください。
      - ラウンドの例はこのセクション（"何をすべきか"）の後段に示します
    - 各ラウンドでのユーザーの回答はツリーを組み替えます。
      - 確定した決定はフロンティアを外側へ押し広げ、それに依存していた質問を解放します。
      - フロンティアを再計算し、次のラウンドの聞き取りへ進んでください。
      - このラウンドでまだ未解決の別の質問に答えが依存している質問は、このラウンドではなく後のラウンドにまわしてください。
    - 事実を突き止めるのは常にあなたの仕事であり、開発者の仕事ではありません。
      - フロンティアの質問に環境（ファイルシステム、ツールなど）からの事実が必要な場合は、サブエージェントを派遣して調べさせてください。
        - ただし調べるのみ。副作用を伴う操作はサブエージェントに絶対に実行させないでください。
      - 自分で調べられることをユーザーに尋ねないでください。
      - ただしそこでブロックしないこと。実行中の調査は未確定の前提なので、待つのはその調査の下流にある質問だけになります。
      - 残りのフロンティアについての聞き取りは並行して進めてください。
      - 決定権は全て開発者のものです。一つひとつを開発者に提示し、回答を待つこと。
        - 開発者の回答を全て明確に、解釈の余地なく理解できるまで、あなたと開発者の間に誤解が生じないように、聞き取りを行なってください。
      - 仕様の聞き取りが完了するのは、フロンティアが空になったときです。
        - デザインツリーのすべての枝を訪れ、暗黙のうちに仮定されたものが何も残っていない状態としてください。
        - 共通の理解に到達したと開発者が確認するまで、それに基づいて動き出してはいけません。
  2. 既存ドキュメントの確認、擦り合わせ
    - 開発者から聞き取った仕様と既存ドキュメントの間に矛盾があれば、必ず指摘し、詰めてください。
  3. 基本設計
    - 全体の機能に対して、今回の開発内容がどのように位置づけられるかをまとめてください。
  4. 詳細設計
    - 今回の開発内容について、具体的にどのような実装が必要かをまとめてください。
      - それぞれの実装がなぜ必要か、必ず整理してください。
      - データベースやストレージなど、永続化するデータに対して破壊的な変更を含む場合、開発者の合意が必ず必要です。合意が得られていない場合、1へ戻ってください。
  5. ドキュメント整理
    - ここまで設計した内容を、docs/以下へ整理して書き出してください。
    - 以下のスキルを使用して下さい。
      - cognitive-rhythm-writing
        - 文章を書く時は必ず使用
      - i-have-adhd
        - 文章を書く時は必ず使用
      - frontend-design
        - フロントエンド作成時は必ず使用
  6. レビュー依頼
    - 作成したドキュメントについて、開発者へレビューを依頼してください。

  ## ラウンドの例

  ```
  ❓ **Q1** - **<質問のタイトル>**: <質問の本文。複数段落になってもよく、選択肢を含めてもよい>

  ➡️ <あなたの推奨する答え>

  ---

  ❓ **Q2** - **<質問のタイトル>**: <質問の本文。複数段落になってもよく、選択肢を含めてもよい>

  ➡️ <あなたの推奨する答え>
  ```

</section>

<section title="ドキュメントについて">

  ## ファイル構成

  すべてのドキュメントは docs/ 配下に配置します。
  （.claude/skills/feature/docs/ ではなく、プロジェクトルートの docs/ です。）

  ```
  docs/
  ├── devops/
  │   ├── {slug}/
  │   │   └── index.html                        ← 開発/運用についてまとめる
  │   │
  │   └── index.html                            ← devops/のインデックスページ
  │
  ├── features/
  │   ├── {feature-name}/
  │   │   └── index.html                        ← 機能について全てまとめる
  │   │
  │   ├── {feature-name}/
  │   │   └── index.html
  │   │
  │   └── index.html                            ← features/のインデックスページ
  │
  ├── issues/
  │   ├── {issue-name}/
  │   │   └── index.html                        ← 先送りにした課題についてまとめる
  │   │
  │   └── index.html                            ← issues/のインデックスページ
  │
  ├── sessions/                                 ← 機能について開発を行ったセッション単位の決定事項などをまとめる
  │   │   ├── {YYYYMMDD-HHMM}-{summary}/        ← セッション単位でこのディレクトリを作成する
  │   │   │   └── index.html                    ← セッションで開発する内容や決定事項についてまとめる
  │   │   │
  │   │   └── {YYYYMMDD-HHMM}-{summary}/
  │   │       └── index.html
  │   │
  │   └── index.html                            ← sessions/のインデックスページ
  │
  ├── ui/
  │   ├── components/                           ← コンポーネントの見本を状態別でまとめる
  │   │   ├── {component-name}/
  │   │   │   └── index.html
  │   │   │
  │   │   └── index.html                        ← ui/components/のインデックスページ
  │   │
  │   ├── pages/                                ← モックとして画面遷移のみ動作するページ見本
  │   │   ├── {path}/{to}/{page}/               ← ページパス
  │   │   │   └── index.html
  │   │   │
  │   │   └── index.html                        ← ui/pages/のインデックスページ
  │   │
  │   └── principles.html                       ← ui設計全体の基本方針についてまとめる
  │
  ├── index.html                                ← ドキュメント全体の説明、インデックスページ
  ├── database/                                 ← DB設計についてまとめる
  │   ├── {table-name}/
  │   │   └── index.html                        ← テーブルについてまとめる。なぜこのテーブルが必要か、他のテーブルとの関係、ER図
  │   │
  │   └── index.html                            ← database/のインデックスページ
  │
  ├── glossary.html                             ← 用語についてまとめる
  └── sidebar.js                                ← 全ページ共通のサイドバー（横断ナビ）を注入するスクリプト
  ```

  すべてのページには共通サイドバーを表示します。詳細は後続セクション **共通サイドバー (docs/sidebar.js) について** を参照してください。
    
  ## 新規ページの雛形

  新しい HTML ページを作成するときは、ゼロから書かず **既存の近いページを複製して雛形**にしてください
  （例: 機能ページなら `docs/features/dashboard/index.html`）。
  これにより `<head>`・Tailwind の読み込み方法・共通サイドバーの `<script>` 設置（後述）など、ページ間の体裁を統一します。

  ## セッションディレクトリの日時

  `{YYYYMMDD-HHMM}` は `date +%Y%m%d-%H%M`（JST）で取得した値を使用してください。

  ## UIデザイン

  UIを作成する際は /frontend-design スキルを使用してください。

  ## 文章規範

  文章を構成する際は /cognitive-rhythm-writing スキルを使用してください。

</section>

<section title="各ディレクトリについて">

  # 各ディレクトリについて

  <section path="docs/devops/">
    <section path="docs/devops/{slug}/">
      <section path="docs/devops/{slug}/index.html">

        ## docs/devops/{slug}/index.html

        開発/運用についての決まり事について、これを見れば把握できるようなドキュメントにしてください。

        特に、私のコードをあなたがレビューして修正するような場合や、あなたのコードを私が修正して実装したような場合に、
        新しく合意した開発規約について今後規約に沿った開発が行えるように、このドキュメントを更新してください。

      </section>
    </section>

    <section path="docs/devops/index.html">

      ## docs/devops/index.html

      doc/devops/ ディレクトリは、開発/運用についてのドキュメントを配置してください。
      それぞれのドキュメントへアクセスしやすいように、カテゴリごとにセクションを分けて、それぞれのドキュメントへリンクを配置してください。
      特定のドキュメントへのリンクは複数存在しても問題ありません。

    </section>
  </section>

  <section path="docs/features/">
    <section path="docs/features/{feature-name}/">
      <section path="docs/features/{feature-name}/index.html">

        ## docs/features/{feature-name}/index.html

        特定の機能についての全体像から詳細まで、これを見れば機能について把握できるようなドキュメントにしてください。

        以下を含めてください。

        - 関連する画面
        - 関連するコンポーネント（サンプルデータでのプレビュー）

      </section>
    </section>

    <section path="docs/features/index.html">

      ## docs/features/index.html

      doc/features/ ディレクトリは、機能ごとのドキュメントを配置してください。
      機能ごとのそれぞれのドキュメントへアクセスしやすいように、カテゴリごとにセクションを分けて、それぞれのドキュメントへリンクを配置してください。
      特定のドキュメントへのリンクは複数存在しても問題ありません。

    </section>
  </section>

  <section path="docs/issues/">
    <section path="docs/issues/{issue-name}/">
      <section path="docs/issues/{issue-name}/index.html">

        ## docs/issues/{issue-name}/index.html

        セッション中に発見し、先送りにした課題などについて、後から対応できるようなドキュメントにしてください。

        以下を含めてください。

        - 概要
        - 先送りとした理由
        - 優先度

      </section>
    </section>

    <section path="docs/issues/index.html">

      ## docs/issues/index.html

      doc/issues/ ディレクトリは、先送りにした課題などについてのドキュメントを配置してください。
      それぞれのドキュメントへアクセスしやすいように、カテゴリごとにセクションを分けて、それぞれのドキュメントへリンクを配置してください。
      特定のドキュメントへのリンクは複数存在しても問題ありません。

    </section>
  </section>

  <section path="docs/sessions/">
    <section path="docs/sessions/{YYYYMMDD-HHMM}-{summary}/">
      <section path="docs/sessions/{YYYYMMDD-HHMM}-{summary}/index.html">

        ## docs/sessions/{YYYYMMDD-HHMM}-{summary}/index.html

        セッション毎にこのドキュメントを作成してください。
        そのセッションでの機能追加や改修の内容が把握できるようなドキュメントにしてください。

        改修の進み具合がわかるように、HTML内にstateの記述を含めてください。
        （planning | developing | done）

        UIの改修がある場合は、修正イメージを含めてください。
        必要があれば別ファイルに分割し、index.htmlからリンクしてください。
        （ docs/sessions/{YYYYMMDD-HHMM}-{summary}/*.html ）

      </section>
    </section>

    <section path="docs/sessions/index.html">

      ## docs/sessions/index.html

    </section>
  </section>

  <section path="docs/ui/">
    <section path="docs/ui/components/">
      <section path="docs/ui/components/{component-name}/">
        <section path="docs/ui/components/{component-name}/index.html">

          ## docs/ui/components/{component-name}/index.html

          doc/sessions/ ディレクトリは、過去のセッション（ features/{feature-name}/sessions/ ）のインデックスページです。
          セッションの履歴がわかりやすいようなドキュメントにしてください。

          以下を含めてください。

          - 日時
          - 見出し
          - 概要（１、２行程度）

        </section>
      </section>

      <section path="docs/ui/components/index.html">

        ## docs/ui/components/index.html

        コンポーネントの解説と見本を配置したドキュメントにしてください。

        UIデザインの設計は frontend-design スキルを使用してください。

        複数の状態を持つコンポーネントの場合、Storybook (storybookjs/storybook) のように、状態ごとのコンポーネントの見た目を確認できるようにしてください。

      </section>
    </section>

    <section path="docs/ui/pages/">
      <section path="docs/ui/pages/{path}/{to}/{page}/">
        <section path="docs/ui/pages/{path}/{to}/{page}/index.html">

          ## docs/ui/pages/{path}/{to}/{page}/index.html

          上位ディレクトリからのlayout.tsxや、使用しているコンポーネントを展開し、
          各ページの完全なモックとしてください。

          UIデザインの設計は frontend-design スキルを使用してください。

          状態ごとに複数作成する必要はないです。
          特に理由がない限りwindow.load直後の状態を使用してください。
          データフェッチを伴うページは、サンプルデータを作成して使用してください。

        </section>
      </section>

      <section path="docs/ui/pages/index.html">

        ## docs/ui/pages/index.html

      </section>
    </section>

    <section path="docs/ui/principles.html">

      ## docs/ui/principles.html

      ui設計全体の基本方針についてまとめたものです。
      新しくページやコンポーネントを作成する際に、既存のページと違和感が出ないようなドキュメントとして下さい。

    </section>
  </section>

  <section path="docs/database/">
    <section path="docs/database/{table-name}/">
      <section path="docs/database/{table-name}/index.html">

        ## docs/database/{table-name}/index.html

        本プロジェクトで使用する各テーブルについてのドキュメントです。
        以下を含めてください。

        - ER図
        - 各カラムについての解説
        - 関係テーブルのドキュメントへのリンク

      </section>
    </section>

    <section path="docs/database/index.html">

      ## docs/database/index.html

      本プロジェクトのデータベース構成をまとめたドキュメントです。
      テーブル間の関係に主眼を置いたドキュメントにしてください。
      （テーブルごとのカラムの説明は docs/database/{table-name}/index.html の役割なので省いてください。）
      
      機能ごと（認証、メッセージ送信、など）にセクションを分けて関連するテーブルをまとめてください。

    </section>
  </section>

  <section path="docs/glossary.html">

    ## docs/glossary.html

    本プロジェクトで使用される用語です。
    セッション内で新しい用語が発言された場合は即時用語集を更新してください。
    用語集の更新は最優先事項です。他の作業を止めてでも用語の掘り下げとまとめを優先してください。

    各用語の解説には以下の項目を含めてください。

    - 用例
      - この用語を用いた、開発者とドメインエキスパート（業務の専門家）との会話例
    - 関連する用語
    - 関連する機能

    ### 相互リンクを張る（用語を孤立させない）

    用語を追加・更新したら、その用語が登場する関連ドキュメント（features/{name}/index.html など）の本文から、
    `glossary.html#{用語のid}` への相互リンクを必ず張ってください。
    「用語集に定義はあるが、どの本文からも参照されていない」孤立した用語を残さないことがルールです。

    - 用語側からは「関連する用語」「関連する機能」で関連先へリンクする（双方向につながる状態にする）。
    - 逆に、本文で重要なドメイン用語が出てきたら、初出箇所を用語集の該当用語へリンクする。
    - 孤立の有無は機械的に確認できます。`glossary.html` の `id="..."` 一覧と、全 HTML 内の `glossary.html#...` 参照を突き合わせ、被参照ゼロの用語が無いかをチェックしてください（リンク切れ・サイドバー未掲載の確認も同時に行うとよい）。

  </section>

  <section path="docs/sidebar.js">

    ## docs/sidebar.js

    docs/ 配下のすべての HTML ページには、ドキュメント間を横断するための共通サイドバーを表示します。
    サイドバーは docs/sidebar.js が動的に注入します（ビルド不要の静的サイトのため、共通レイアウトの代わり）。
    sidebar.js は自身の `<script src>` から docs/ ルートへの相対パスを判別するため、ページの階層に関わらず正しいリンクを生成します（ローカルの file:// でも GitHub Pages でも動作します）。

    ### 新しいページを追加するときのルール

    1. ページ末尾の `</body>` 直前に、サイドバー読み込み用の script を追加する。
        `src` は **そのページから docs/ ルートへの相対パス** にする。

        - docs 直下（例: glossary.html）            → `<script src="sidebar.js" defer></script>`
        - 1階層下（例: features/index.html）        → `<script src="../sidebar.js" defer></script>`
        - 2階層下（例: features/{name}/index.html） → `<script src="../../sidebar.js" defer></script>`
        - さらに深い階層（例: features/{name}/sessions/{x}/index.html）→ 階層分だけ `../` を増やす

    2. 新しい機能ドキュメントや課題ドキュメントを作成したら、docs/sidebar.js の `groups` 配列に
        リンク（ルート相対パス・ラベル・インデント階層）を追記する。これを忘れるとサイドバーに項目が出ない。

    ### セッション履歴（Session）の表示件数上限

    サイドバーのセッション履歴表示件数は直近5件としてください。
    5件以上存在する場合は溢れたものを削除、総件数を表示してください。

    ### 完了した課題（Issue）の削除

    完了したIssueについては、サイドバーから削除してください。
    （該当Issueにはインデックスページからアクセス可能）

    ### 注意

    サイドバーを追加・変更した直後は、ブラウザキャッシュにより既存タブへ反映されないことがある。
    反映されない場合はスーパーリロード（Cmd/Ctrl+Shift+R）で確認すること。

  </section>

  <section path="docs/index.html">

    ## docs/index.html

  </section>

</section>
