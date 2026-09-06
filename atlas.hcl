# Atlas によるスキーマ管理
#
#   スキーマの正本は schema/ 以下の SQL である。
#   変更するときは schema/ を編集し、差分を生成する。
#
#     pnpm schema:diff <名前>   差分を migrations/ に生成する
#     pnpm schema:apply         生成された差分を適用する
#     pnpm schema:status        どこまで適用されているかを見る
#
#   生成された SQL は必ず人が読んでから適用すること。
#   列名の変更のつもりでも「削除して追加」が生成されることがある。

variable "database_url" {
  type    = string
  default = getenv("DATABASE_URL")
}

# Atlas が差分を計算するために使う、空の作業用データベース。
# 実行のたびに中身を作り直すので、他と共有してはいけない。
variable "dev_url" {
  type    = string
  default = getenv("ATLAS_DEV_URL")
}

env "local" {
  # スキーマの正本
  src = "file://schema"

  url = var.database_url
  dev = var.dev_url

  migration {
    dir = "file://migrations"
  }
}
