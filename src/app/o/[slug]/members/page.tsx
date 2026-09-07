import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { InviteForm } from '#features/organization/InviteForm.tsx';
import { listPendingInvitations } from '#features/organization/invitations.ts';
import { RemoveForm, RevokeForm, RoleForm } from '#features/organization/MemberActions.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization, listMembers } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';

export const metadata: Metadata = { title: 'メンバー' };

/*
 * メンバーの一覧と、招待。
 *
 * メンバーなら誰でも見られる。誰が同じ組織に居るのかは、
 * メンションの相手を探すときにも要る。
 * 変えられるのは組織管理者だけで、その判定は SQL の中にある。
 */
export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const { scope, user } = found;
  const [organization, members, invitations] = await Promise.all([
    getOrganization(scope),
    listMembers(scope),
    listPendingInvitations(scope),
  ]);

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={user.displayName}
      isOrgAdmin={scope.isOrgAdmin}
      current="members"
    >
      <div className="app-head">
        <div>
          <h2>メンバー</h2>
          <div className="sub">
            {organization.name} / {members.length} 人
          </div>
        </div>
      </div>

      {scope.isOrgAdmin ? <InviteForm slug={slug} /> : null}

      <div className="app-people">
        {members.map((member) => (
          <div className="app-person" key={member.userId}>
            <span className="hanko sm" aria-hidden="true">
              {[...member.displayName][0] ?? '?'}
            </span>
            <span className="who">
              <span className="nm">{member.displayName}</span>
              {member.email ? <span className="ad">{member.email}</span> : null}
            </span>

            {member.locked ? (
              <span className="app-role" title="パスワードでのログインを停止しています">
                ロック中
              </span>
            ) : null}

            {scope.isOrgAdmin ? (
              <>
                <RoleForm
                  slug={slug}
                  userId={member.userId}
                  role={member.role}
                  self={member.userId === scope.userId}
                />
                <RemoveForm
                  slug={slug}
                  userId={member.userId}
                  displayName={member.displayName}
                />
              </>
            ) : (
              <span className="app-role" data-role={member.role}>
                {member.role === 'admin' ? '組織管理者' : 'メンバー'}
              </span>
            )}
          </div>
        ))}
      </div>

      {scope.isOrgAdmin ? (
        <>
          <div className="app-head" style={{ marginTop: '2rem' }}>
            <div>
              <h2>送った招待</h2>
              <div className="sub">受け取られるまで、ここに残ります</div>
            </div>
          </div>

          {invitations.length === 0 ? (
            <p className="app-empty">未処理の招待はありません。</p>
          ) : (
            <div className="app-people">
              {invitations.map((invitation) => (
                <div
                  className="app-person app-pending"
                  data-expired={invitation.expired}
                  key={invitation.id}
                >
                  <span className="who">
                    <span className="nm">{invitation.email}</span>
                    <span className="ad">
                      {invitation.invitedByName} が招待
                      {invitation.expired ? ' / 期限切れ' : ''}
                    </span>
                  </span>
                  <span className="app-role" data-role={invitation.role}>
                    {invitation.role === 'admin' ? '組織管理者' : 'メンバー'}
                  </span>
                  <RevokeForm slug={slug} invitationId={invitation.id} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </OrgShell>
  );
}
