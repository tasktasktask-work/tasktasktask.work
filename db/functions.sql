-- ==========================================================================
-- 関数とトリガ
--
-- Atlas の管理下に置いていない。無料の範囲では関数を扱えないためである。
-- schema/ に置くと migrate diff がエラーになるので、ここに分けてある。
--
-- 適用は pnpm schema:apply が migrate apply のあとに行う。
-- 何度流しても同じ結果になるように書くこと。
--
-- 注意: Atlas Pro（atlas login 済み）では関数とトリガも差分の対象になる。
--       その場合、schema/ に無いこれらを「消すべきもの」と判断しうる。
--       Pro へ移るときは、この扱いを見直す必要がある。
-- ==========================================================================

-- updated_at を持つテーブルに共通で仕掛ける。
--
-- アプリケーション側で毎回 updated_at = now() を書く方式は書き忘れが起きる。
-- そして見つけにくい。スレッド一覧の既定の並び順が更新の新しい順なので、
-- 更新したのに一覧で下に沈む、という形でしか表面化しない。
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- comments は updated_at を持たない（投稿後に更新される経路がない）ので対象外。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'users', 'organization_members',
    'projects', 'project_members', 'threads', 'tags'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_set_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END;
$$;
