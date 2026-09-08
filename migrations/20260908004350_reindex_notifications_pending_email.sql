-- atlas:txmode none

--
-- 巡回が拾う行の索引を、諦めた行を除いた条件へ張り替える。
--
-- CREATE INDEX CONCURRENTLY はトランザクションの中で実行できないため、
-- 列を足す移行とはファイルを分けてある
-- （docs/devops/database-migration/index.html を参照）。
--
-- 先に落としてから張る。張ってから落とす順にすると、
-- 途中の状態で索引の名前が二つ必要になり、スキーマの定義と食い違う。
-- この索引を使うのは毎分の巡回だけなので、無い間は総なめになるだけで済む。
DROP INDEX "notifications_pending_email";

CREATE INDEX CONCURRENTLY "notifications_pending_email"
  ON "notifications" ("created_at")
  WHERE ((emailed_at IS NULL) AND (email_gave_up_at IS NULL));
