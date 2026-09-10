import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

/*
 * ログインの要らない一枚もの。
 *
 * 料金、規約、方針、表記。どれも外から読まれる。
 * 決済代行の審査もここを見るので、認証の後ろに置かない。
 *
 * 画面の枠（OrgShell）は使わない。あちらは組織のスコープを前提にしている。
 */

/** 公開ページの並び。ログイン画面の足元からも同じものを出す。 */
export const PUBLIC_PAGES: { path: Route; label: string }[] = [
  { path: '/pricing' as Route, label: '料金' },
  { path: '/terms' as Route, label: '利用規約' },
  { path: '/privacy' as Route, label: 'プライバシーポリシー' },
  { path: '/legal' as Route, label: '特定商取引法に基づく表記' },
];

export function PublicPage({
  title,
  lede,
  revised,
  children,
}: {
  title: string;
  lede?: string;
  /** 最終改定日。規約と方針には要る。まだ決まっていなければ Todo を渡す。 */
  revised?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="pub">
      <Link href="/" className="pub-brand">
        <span className="m">3</span>TASK3
      </Link>

      <h1>{title}</h1>
      {lede ? <p className="lede">{lede}</p> : null}

      {children}

      <nav className="pub-foot">
        <Link href="/">ログイン</Link>
        {PUBLIC_PAGES.map((page) => (
          <Link key={page.path} href={page.path}>
            {page.label}
          </Link>
        ))}
        {revised ? <span className="rev">最終改定 {revised}</span> : null}
      </nav>
    </main>
  );
}

/**
 * まだ埋まっていない欄。
 *
 * 事業者の名前や所在地は、こちらでは決められない。
 * 空白で置くと埋め忘れたまま公開されるので、目に付く形にしておく。
 */
export function Todo({ children }: { children: ReactNode }) {
  return <span className="todo">〔{children}〕</span>;
}

/**
 * 事業者の情報を一つ出す。埋まっていなければ印を出す。
 *
 * 呼ぶ側で毎回 null を見分けると、片方だけ書き忘れる。
 */
export function Fact({ value, label }: { value: string | null; label: string }) {
  return value === null ? <Todo>{label}を記入してください</Todo> : <>{value}</>;
}
