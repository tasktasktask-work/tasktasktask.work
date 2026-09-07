import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization, listMembers } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import {
  AddMemberForm,
  ChangeMemberRoleForm,
  RemoveMemberForm,
} from '#features/project/ProjectMemberActions.tsx';
import { ProjectTabs } from '#features/project/ProjectTabs.tsx';
import {
  listProjectLinks,
  listProjectMembers,
  resolveProject,
} from '#features/project/queries.ts';

export const metadata: Metadata = { title: 'プロジェクトのメンバー' };

/*
 * 非公開プロジェクトのメンバー。
 *
 * 開けるのは組織管理者と、プロジェクト管理者だけである。
 * 公開プロジェクトでも開ける。切り替える前に顔ぶれを揃えられないと、
 * 非公開にした瞬間に誰も入っていないプロジェクトができる。
 */
export default async function ProjectMembersPage({
  params,
}: {
  params: Promise<{ slug: string; key: string }>;
}) {
  const { slug, key } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const { scope, user } = found;
  const [organization, project, links] = await Promise.all([
    getOrganization(scope),
    resolveProject(scope, key),
    listProjectLinks(scope),
  ]);

  if (!project?.canManage) {
    return notFound();
  }

  const [members, orgMembers] = await Promise.all([
    listProjectMembers(scope, project.id),
    listMembers(scope),
  ]);

  const registered = new Set(members.map((member) => member.userId));
  const candidates = orgMembers
    .filter((member) => !registered.has(member.userId))
    .map((member) => ({ userId: member.userId, displayName: member.displayName }));

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={user.displayName}
      scope={scope}
      current="project"
      currentProjectKey={project.key}
      projects={links}
    >
      <div className="app-head">
        <div>
          <h2>{project.name}</h2>
          <div className="sub">
            {project.key} / メンバー {members.length} 人
          </div>
        </div>
      </div>

      <ProjectTabs
        slug={slug}
        projectKey={project.key}
        current="members"
        canManage={project.canManage}
      />

      {project.visibility === 'public' ? (
        <div className="app-note">
          このプロジェクトは公開です。組織のメンバー全員が見られるので、
          この一覧はいまのところ閲覧の範囲を変えません。
          非公開に切り替えたときに効きはじめます。
        </div>
      ) : (
        <div className="app-note">
          ここに並んでいる人と、<strong>組織管理者</strong>だけがこのプロジェクトを見られます。
          組織管理者は一覧に出ません。行を持たなくても管理者として扱われるためです。
        </div>
      )}

      <AddMemberForm slug={slug} projectKey={project.key} candidates={candidates} />

      {members.length === 0 ? (
        <p className="app-empty">まだ誰も登録されていません。</p>
      ) : (
        <div className="app-people">
          {members.map((member) => (
            <div className="app-person" key={member.userId}>
              <span className="hanko sm" aria-hidden="true">
                {[...member.displayName][0] ?? '?'}
              </span>
              <span className="who">
                <span className="nm">{member.displayName}</span>
              </span>
              <ChangeMemberRoleForm
                slug={slug}
                projectKey={project.key}
                userId={member.userId}
                isAdmin={member.isAdmin}
              />
              <RemoveMemberForm
                slug={slug}
                projectKey={project.key}
                userId={member.userId}
                displayName={member.displayName}
                visibility={project.visibility}
              />
            </div>
          ))}
        </div>
      )}
    </OrgShell>
  );
}
