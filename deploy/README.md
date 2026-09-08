# デプロイ

VPS では複数のサービスが動いている。
このアプリはそこへ相乗りする形で置く。

```
クライアント =SSL=> Cloudflare ==> VPS
                                   ├── nginx-proxy   （稼働中）
                                   ├── postgres      （稼働中）
                                   └── tasktasktask-work-app
```

VPS のプロジェクトディレクトリに置くのは三つだけである。

```
/path/to/tasktasktask-work/
├── compose.yaml          このディレクトリの compose.yaml を写す
├── .env                  .env.example をもとに手で作る
└── data/attachments/     添付ファイルの置き場（空のディレクトリ）
```

ソースコードは置かない。ビルド済みのイメージだけを push する。

## イメージを作って送る

GitHub Actions の **Deploy** ワークフローを手で起こす
（Actions タブ → Deploy → Run workflow）。

イメージを作り、レジストリへ push するところまでを行う。
**VPS への反映はこのワークフローではやらない。**マイグレーションの順序を
人が見て決める必要があるためである。

必要な secrets は三つ。

| 名前 | 内容 |
|------|------|
| `DOCKER_REGISTRY_HOST` | レジストリのホスト |
| `DOCKER_REGISTRY_USERNAME` | ログインに使う名前 |
| `DOCKER_REGISTRY_PASSWORD` | ログインに使うパスワード |

手元から送ることもできる。

```sh
docker build -t "$REGISTRY/tasktasktask.work:latest" .
docker push "$REGISTRY/tasktasktask.work:latest"
```

## VPS で入れ替える

```sh
ssh VPS
cd /path/to/tasktasktask-work

docker compose pull
docker compose run --rm migrate       # ← アプリを入れ替える前に流す
docker compose up -d
```

## migrate を別サービスにしてある理由

`app` の設定をそのまま使い回すと、`restart: unless-stopped` が
一時的な処理にも付いてしまう。この方針は**終了コードに関わらず起動し直す**ので、
移行が終わるたびに走り直し、止まらなくなる。

`migrate` は Atlas と Node を毎回立ち上げてデータベースを叩くため、
回り続けると CPU を食い尽くす。`profiles` を付けてあるので `up -d` では起動しない。

## メールの設定

`.env` に四つ要る。詳しくは `.env.example` にある。

| 名前 | 内容 |
|------|------|
| `MAIL_TRANSPORT` | 本番は `smtp`。`console` だと誰にも届かない |
| `MAIL_FROM` | 差出人。受信箱は用意していない |
| `SMTP_URL` | Cloudflare Email Service への接続先 |
| `APP_ORIGIN` | メールに載せるリンクの組み立てに使う |

通知メールは、`app` の中で60秒ごとに回る巡回が送る。
cron も常駐プロセスも要らない代わりに、**`app` を二つに増やすと同じ通知が二通届く**。

## 気をつけること

- **マイグレーションは `up -d` の前に流す。**
  順序を守らないと、新しいコードが古いスキーマの上で動く瞬間ができる
- `data/attachments` はコンテナ内の `node`（uid 1000）が書ける必要がある。
  書けないと、画面は動くのに添付のときだけ失敗する
- バックアップはデータベースと `data/attachments` の両方を、同じ時点で取る。
  片方だけ戻しても復旧しない
- **イメージのアーキテクチャと VPS のアーキテクチャを揃える。**
  GitHub の runner は x86_64 である
- **`app` は一つだけ動かす。** 通知メールの巡回がその前提で書いてある

詳しくは [docs/devops/deployment](../docs/devops/deployment/index.html) にある。
