#!/bin/sh
#
# コンテナの中でスキーマを適用する。
#
#   docker compose run --rm app migrate
#
# atlas.hcl を経由せず、接続先を直に渡している。
# 経由すると ATLAS_DEV_URL が読まれる。あれは Atlas が差分計算のために
# 中身を作り直すデータベースであり、本番を指したまま流すと消える。
# apply には要らないので、渡す口ごと無くしてある。

set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL が設定されていません" >&2
  exit 1
fi

echo "--- migrations を適用します ---"
atlas migrate apply --dir "file://migrations" --url "$DATABASE_URL"

echo "--- db/functions.sql を適用します ---"
node scripts/apply-functions.mjs
