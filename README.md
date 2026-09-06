# TASK3

課題も議論も質問も、同じ器に置ける課題管理システム。

<https://tasktasktask.work>

## なぜ作るのか

課題として書けるほど固まっていない相談を、どこに置けばいいのか。
多くの課題管理ツールでは、そういう話は課題の欄に無理やり収めるか、
チャットへ流れて消えていく。

このプロダクトは、その置き場所をつくるところから設計をはじめた。

## 骨格

基本単位は課題ではなく**スレッド**である。
スレッドは三つの**種別**を持ち、そのうちのひとつが課題にあたる。

| 種別 | 意味 | 進捗率 | 期間 | 親子 | ガント |
|------|------|--------|------|------|--------|
| 課題 | やることが決まっていて、終わりの形が言える | 0〜100 | 持つ | 可 | 載る |
| 議論 | 関係者で決めなければ終わらない相談 | 0 か 100 | 持たない | 可 | 載らない |
| 質問 | 知っている人がいれば終わる疑問 | 0 か 100 | 持たない | 可 | 載らない |

三つとも同じ形なので、同じ一覧に並び、同じように親子でつながる。
議論の下に課題を、課題の下に質問をぶら下げられる。

名前の `3` は、この三つの種別と読み合わせられる。

## 状態

開発中。認証まで実装した。

| 機能 | 状態 |
|------|------|
| 認証（パスワード / マジックリンク / ロック） | 実装済み |
| 組織とメンバー、招待 | これから |
| プロジェクト、スレッド、コメント | これから |
| 添付ファイル、タグ、通知 | これから |
| ガントチャート、担当スレッド一覧 | これから |

## 設計ドキュメント

`docs/` に65ページある。仕様だけでなく、**そう決めた理由と、捨てたもの**を書いてある。

ブラウザで `docs/index.html` を開くと読める。ビルドは要らない。

| 場所 | 内容 |
|------|------|
| [用語集](docs/glossary.html) | 34語。既存ツールを下敷きにしていないので、まずここ |
| [機能](docs/features/index.html) | 10機能。画面と振る舞い、決めた理由 |
| [データベース](docs/database/index.html) | 15テーブル。DDL、制約の意図 |
| [UI](docs/ui/principles.html) | 設計方針、コンポーネント見本、ページモック |
| [開発と運用](docs/devops/index.html) | 技術選定、規約、スキーマ移行、デプロイ |
| [先送りした課題](docs/issues/index.html) | 入れなかったものと、その理由 |

## 技術

pnpm / Node.js 24 / Next.js 16 (App Router) / TypeScript 7 / PostgreSQL 18

TypeScript 7 は Go 実装で、従来の JS コンパイラ API を持たない。
そのため Next.js 16.2.11 以降と組でしか動かない。
整形と Lint に Biome を使っているのも、`typescript-eslint` が同じ API に
依存していて移行できないためである。

ORM は使わない。SQL を直接書き、スキーマの正本を `schema/` に置く。
複合外部キーによる「親子はプロジェクトをまたげない」といった保証を、
データベース側で表現したいためである。

スキーマの管理は [Atlas](https://atlasgo.io)、整形と検査は [Biome](https://biomejs.dev)。

## 動かす

devcontainer を開く。PostgreSQL は別に用意する。

```sh
cp .env.example .env      # 接続先を書く
pnpm install
pnpm schema:apply         # スキーマと、関数・トリガを適用する
pnpm dev
```

Atlas は Node の依存ではないので、別に入れる。

```sh
ARCH=$(uname -m | sed "s/x86_64/amd64/;s/aarch64/arm64/")
curl -fsSL -o atlas "https://release.ariga.io/atlas/atlas-linux-$ARCH-$(cat .atlas-version)"
chmod +x atlas && sudo mv atlas /usr/local/bin/
```

版は `.atlas-version` に固定してある。CI と Dockerfile も同じものを読む。

## 検査

```sh
pnpm check    # 型、Biome、共有スタイルの一致、移行の規約
pnpm test     # 実データベースに対する検査（制約と認証）
```

`pnpm test` はデータベースに繋ぐ。各テストはトランザクションの中で走り、最後に巻き戻す。

GitHub Actions の **Test** ワークフローが、push のたびに同じものを走らせる
（PostgreSQL 18 をサービスコンテナで立てる）。
詳しくは [継続的インテグレーション](docs/devops/continuous-integration/index.html) にある。

## デプロイ

ビルドしたイメージを VPS のレジストリへ push し、
VPS 側には `compose.yaml` と `.env` とボリューム用のディレクトリだけを置く。

手順は [deploy/README.md](deploy/README.md) と
[デプロイ構成](docs/devops/deployment/index.html) にある。

## ライセンス

[MIT](LICENSE)
