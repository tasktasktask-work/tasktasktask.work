/* ==========================================================================
   共通サイドバー
   docs/ 配下のすべての HTML から、ルートへの相対パスで読み込む。
     docs 直下      → <script src="sidebar.js" defer></script>
     1階層下        → <script src="../sidebar.js" defer></script>
     n階層下        → ../ を n 個

   ルートの位置は自身の <script src> から逆算するので、file:// でも
   GitHub Pages でも動作する。

   ページを追加したら groups へ追記すること。追記を忘れるとサイドバーに出ない。
   ========================================================================== */
(function () {
  "use strict";

  /* ルートへの相対プレフィックス（末尾に / を含む。docs 直下なら "" ） */
  var me = document.currentScript || (function () {
    var s = document.getElementsByTagName("script");
    return s[s.length - 1];
  })();
  var ROOT = (me.getAttribute("src") || "").replace(/sidebar\.js.*$/, "");

  /* ---------------------------------------------------------------------
     ナビゲーション定義
     path はルート相対。depth は 1 か 2（2 は入れ子表示）。
     --------------------------------------------------------------------- */
  var groups = [
    {
      label: "はじめに",
      items: [
        { path: "index.html",    label: "このドキュメントについて" },
        { path: "glossary.html", label: "用語集" }
      ]
    },
    {
      label: "機能",
      items: [
        { path: "features/index.html",                label: "機能の一覧" },
        { path: "features/authentication/index.html", label: "認証", d: 2 },
        { path: "features/organization/index.html",   label: "組織とメンバー", d: 2 },
        { path: "features/project/index.html",        label: "プロジェクト", d: 2 },
        { path: "features/thread/index.html",         label: "スレッド", d: 2 },
        { path: "features/comment/index.html",        label: "コメント", d: 2 },
        { path: "features/attachment/index.html",     label: "添付ファイル", d: 2 },
        { path: "features/tag/index.html",            label: "タグ", d: 2 },
        { path: "features/notification/index.html",   label: "通知とウォッチ", d: 2 },
        { path: "features/gantt/index.html",          label: "ガントチャート", d: 2 },
        { path: "features/dashboard/index.html",      label: "担当スレッド一覧", d: 2 }
      ]
    },
    {
      label: "データベース",
      items: [
        { path: "database/index.html",                     label: "全体構成" },
        { path: "database/organizations/index.html",       label: "organizations", d: 2 },
        { path: "database/users/index.html",               label: "users", d: 2 },
        { path: "database/organization_members/index.html",label: "organization_members", d: 2 },
        { path: "database/sessions/index.html",            label: "sessions", d: 2 },
        { path: "database/magic_link_tokens/index.html",   label: "magic_link_tokens", d: 2 },
        { path: "database/invitations/index.html",         label: "invitations", d: 2 },
        { path: "database/projects/index.html",            label: "projects", d: 2 },
        { path: "database/project_members/index.html",     label: "project_members", d: 2 },
        { path: "database/threads/index.html",             label: "threads", d: 2 },
        { path: "database/comments/index.html",            label: "comments", d: 2 },
        { path: "database/comment_checks/index.html",      label: "comment_checks", d: 2 },
        { path: "database/comment_mentions/index.html",    label: "comment_mentions", d: 2 },
        { path: "database/attachments/index.html",         label: "attachments", d: 2 },
        { path: "database/tags/index.html",                label: "tags", d: 2 },
        { path: "database/thread_tags/index.html",         label: "thread_tags", d: 2 },
        { path: "database/watches/index.html",             label: "watches", d: 2 },
        { path: "database/notifications/index.html",       label: "notifications", d: 2 }
      ]
    },
    {
      label: "UI",
      items: [
        { path: "ui/principles.html",                        label: "設計方針" },
        { path: "ui/components/index.html",                  label: "コンポーネント" },
        { path: "ui/components/hanko-avatar/index.html",     label: "ハンコアバター", d: 2 },
        { path: "ui/components/thread-type-badge/index.html",label: "種別バッジ", d: 2 },
        { path: "ui/components/progress-input/index.html",   label: "進捗率入力", d: 2 },
        { path: "ui/components/gantt-bar/index.html",        label: "ガントバー", d: 2 },
        { path: "ui/pages/index.html",                       label: "ページモック" },
        { path: "ui/pages/login/index.html",                 label: "ログイン", d: 2 },
        { path: "ui/pages/join/index.html",                  label: "招待を受ける", d: 2 },
        { path: "ui/pages/o/[slug]/index.html",              label: "プロジェクト一覧", d: 2 },
        { path: "ui/pages/o/[slug]/members/index.html",      label: "メンバー", d: 2 },
        { path: "ui/pages/o/[slug]/tags/index.html",         label: "タグ", d: 2 },
      { path: "ui/pages/o/[slug]/settings/index.html",     label: "組織の設定", d: 2 },
        { path: "ui/pages/o/[slug]/dashboard/index.html",    label: "担当スレッド", d: 2 },
        { path: "ui/pages/me/index.html",                    label: "アカウント", d: 2 },
        { path: "ui/pages/o/[slug]/p/[key]/index.html",      label: "スレッド一覧", d: 2 },
        { path: "ui/pages/o/[slug]/p/[key]/new/index.html",   label: "スレッドを立てる", d: 2 },
        { path: "ui/pages/o/[slug]/p/[key]/members/index.html",  label: "プロジェクトのメンバー", d: 2 },
        { path: "ui/pages/o/[slug]/p/[key]/settings/index.html", label: "プロジェクトの設定", d: 2 },
        { path: "ui/pages/o/[slug]/p/[key]/t/[number]/index.html", label: "スレッド詳細", d: 2 },
        { path: "ui/pages/o/[slug]/p/[key]/gantt/index.html",label: "ガントチャート", d: 2 }
      ]
    },
    {
      label: "開発と運用",
      items: [
        { path: "devops/index.html",                      label: "一覧" },
        { path: "devops/tech-stack/index.html",           label: "技術スタック", d: 2 },
        { path: "devops/documentation-rules/index.html",  label: "ドキュメント規約", d: 2 },
        { path: "devops/coding-conventions/index.html",   label: "コーディング規約", d: 2 },
        { path: "devops/database-migration/index.html",   label: "スキーマ移行", d: 2 },
        { path: "devops/deployment/index.html",           label: "デプロイ構成", d: 2 },
        { path: "devops/continuous-integration/index.html", label: "CI", d: 2 },
        { path: "devops/commit-workflow/index.html",     label: "コミットの流れ", d: 2 }
      ]
    },
    {
      /* 完了した Issue はここから削除する。インデックスページから辿れる。 */
      label: "先送りした課題",
      items: [
        { path: "issues/index.html",                          label: "課題の一覧" },
        { path: "issues/account-settings/index.html",          label: "アカウントの設定", d: 2 },
        { path: "issues/organization-signup/index.html",       label: "組織を自分で作る", d: 2 },
        { path: "issues/rejection-representation/index.html",  label: "却下の表現", d: 2 },
        { path: "issues/custom-workflow/index.html",           label: "状態のカスタマイズ", d: 2 },
        { path: "issues/thread-mutability/index.html",         label: "スレッドの可変性", d: 2 },
        { path: "issues/gantt-enhancement/index.html",         label: "ガントの拡張", d: 2 },
        { path: "issues/notification-enhancement/index.html",  label: "通知の拡張", d: 2 },
        { path: "issues/full-text-search/index.html",          label: "全文検索", d: 2 },
        { path: "issues/virus-scan/index.html",                label: "ウイルススキャン", d: 2 },
        { path: "issues/origin-encryption/index.html",         label: "オリジンまでの経路", d: 2 },
        { path: "issues/audit-log/index.html",                 label: "監査ログ", d: 2 },
        { path: "issues/i18n/index.html",                      label: "多言語対応", d: 2 },
        { path: "issues/billing/index.html",                   label: "課金とプラン", d: 2 }
      ]
    },
    {
      /* 直近 5 件まで。溢れた分は削除し、総件数を表示する。 */
      label: "セッション",
      sessionTotal: 14,
      items: [
        { path: "sessions/index.html", label: "履歴" },
        { path: "sessions/20260908-1113-tags/index.html", label: "2026-09-08 タグ", d: 2 },
        { path: "sessions/20260908-0943-notification-mail/index.html", label: "2026-09-08 通知メール", d: 2 },
        { path: "sessions/20260908-0028-notifications/index.html", label: "2026-09-08 通知", d: 2 },
        { path: "sessions/20260907-2320-comments/index.html", label: "2026-09-07 コメント", d: 2 },
        { path: "sessions/20260907-1920-threads/index.html", label: "2026-09-07 スレッド", d: 2 }
      ]
    }
  ];

  /* ---------------------------------------------------------------------
     現在地の判定
     --------------------------------------------------------------------- */
  function normalize(p) {
    var a = document.createElement("a");
    a.href = p;
    return a.pathname.replace(/\/$/, "/index.html");
  }
  var here = normalize(location.href);

  /* ---------------------------------------------------------------------
     組み立て
     --------------------------------------------------------------------- */
  var nav = document.createElement("nav");
  nav.id = "docnav";
  nav.setAttribute("aria-label", "ドキュメント全体のナビゲーション");

  var brand = document.createElement("a");
  brand.className = "nav-brand";
  brand.href = ROOT + "index.html";
  brand.innerHTML =
    '<span class="bn"><span class="mark">3</span>TASK3</span>' +
    '<span class="bs">design documents</span>';
  nav.appendChild(brand);

  groups.forEach(function (g) {
    var d = document.createElement("details");
    d.className = "nav-group";

    var s = document.createElement("summary");
    s.textContent = g.label;
    d.appendChild(s);

    var isCurrentGroup = false;

    g.items.forEach(function (it) {
      var a = document.createElement("a");
      a.className = "nav-link" + (it.d === 2 ? " d2" : "");
      a.href = ROOT + it.path;
      a.textContent = it.label;
      if (normalize(a.href) === here) {
        a.classList.add("current");
        a.setAttribute("aria-current", "page");
        isCurrentGroup = true;
      }
      d.appendChild(a);
    });

    /* セッションは直近 5 件のみ掲載する。総件数を添える。 */
    if (g.sessionTotal && g.sessionTotal > 5) {
      var c = document.createElement("div");
      c.className = "nav-count";
      c.textContent = "全 " + g.sessionTotal + " 件";
      d.appendChild(c);
    }

    d.open = isCurrentGroup;
    nav.appendChild(d);
  });

  /* ---------------------------------------------------------------------
     モバイル開閉
     --------------------------------------------------------------------- */
  var toggle = document.createElement("button");
  toggle.id = "navtoggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "ナビゲーションを開閉");
  toggle.textContent = "≡";

  var scrim = document.createElement("div");
  scrim.id = "navscrim";

  function close() { document.body.classList.remove("nav-open"); }
  toggle.addEventListener("click", function () {
    document.body.classList.toggle("nav-open");
  });
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });

  document.body.appendChild(nav);
  document.body.appendChild(scrim);
  document.body.appendChild(toggle);

  /* 現在地がサイドバーの表示範囲外なら送る */
  var cur = nav.querySelector(".current");
  if (cur) {
    var top = cur.offsetTop;
    if (top > nav.clientHeight - 80) nav.scrollTop = top - nav.clientHeight / 2;
  }
})();
