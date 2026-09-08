import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { listProjectLinks } from '#features/project/queries.ts';
import { listTagsForAdmin } from '#features/tag/queries.ts';
import { NewTagForm, TagRowForms } from '#features/tag/TagAdmin.tsx';

export const metadata: Metadata = { title: 'タグ' };

/*
 * タグの管理。
 *
 * 組織の設定（/o/{slug}/settings）の中に置かなかったのは、
 * あの画面が組織管理者以外に 404 を返すからである。
 * タグは誰でも作れる決まりなので、置いた時点で決まりと食い違う。
 *
 * 使用数は組織のすべてのスレッドを数える。閲覧できるものだけに絞ると、
 * 消したときに実際に外れる行数より少ない数を見せることになり、
 * 歯止めとして働かない。
 */
export default async function TagsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const { scope, user } = found;
  const [organization, tags, links] = await Promise.all([
    getOrganization(scope),
    listTagsForAdmin(scope),
    listProjectLinks(scope),
  ]);

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={user.displayName}
      scope={scope}
      current="tags"
      projects={links}
    >
      <div className="app-head">
        <div>
          <h2>タグ</h2>
          <div className="sub">
            {organization.name} / {tags.length} 件 / 誰でも作れます
          </div>
        </div>
      </div>

      <NewTagForm slug={slug} />

      {tags.length === 0 ? (
        <p className="app-empty">タグはまだありません。</p>
      ) : (
        <div className="app-people">
          {tags.map((tag) => (
            <TagRowForms key={tag.id} slug={slug} tag={tag} />
          ))}
        </div>
      )}

      <p className="app-note">
        消すと、付いていたスレッドとの結びも一緒に消えます。取り消せません。
        件数はこの組織のすべてのスレッドを数えたもので、
        自分に見えないプロジェクトのぶんも含みます。
      </p>
    </OrgShell>
  );
}
