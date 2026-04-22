
import { createJsonFileStore } from '../utils/jsonFileStore.mjs';

function makeId(prefix='id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

export function createTeamStore(filePath) {
  const db = createJsonFileStore(filePath, { orgs: [], invitations: [] });
  return {
    listOrgsForUser(userId) {
      const data = db.read();
      return data.orgs.filter((o) => (o.members || []).some((m) => m.userId === userId));
    },
    listOrgMembers(orgId) {
      const data = db.read();
      const org = data.orgs.find((o) => o.id === orgId);
      return org ? (org.members || []) : [];
    },
    getOrg(orgId) {
      const data = db.read();
      return data.orgs.find((o) => o.id === orgId) || null;
    },
    createOrg({ name, ownerUserId, ownerEmail }) {
      const data = db.read();
      const org = {
        id: makeId('org'),
        name: name || 'Untitled Org',
        createdAt: new Date().toISOString(),
        members: [{ userId: ownerUserId, email: ownerEmail || null, role: 'owner', joinedAt: new Date().toISOString() }],
        projectsShared: []
      };
      data.orgs.push(org);
      db.write(data);
      return org;
    },
    inviteMember({ orgId, email, role='viewer', invitedByUserId }) {
      const data = db.read();
      const invitation = {
        id: makeId('invite'),
        orgId, email, role, invitedByUserId,
        token: makeId('tok'), status: 'pending', createdAt: new Date().toISOString()
      };
      data.invitations.push(invitation);
      db.write(data);
      return invitation;
    },
    listInvitations(orgId) {
      const data = db.read();
      return data.invitations.filter((i) => i.orgId === orgId);
    },
    acceptInvitation(token, user) {
      const data = db.read();
      const invite = data.invitations.find((i) => i.token === token && i.status === 'pending');
      if (!invite) return null;
      const org = data.orgs.find((o) => o.id === invite.orgId);
      if (!org) return null;
      org.members = org.members || [];
      if (!org.members.find((m) => m.userId === user.id)) {
        org.members.push({ userId: user.id, email: user.email || invite.email, role: invite.role, joinedAt: new Date().toISOString() });
      }
      invite.status = 'accepted';
      invite.acceptedAt = new Date().toISOString();
      db.write(data);
      return { org, invitation: invite };
    },
    shareProject({ orgId, projectId, role='editor' }) {
      const data = db.read();
      const org = data.orgs.find((o) => o.id === orgId);
      if (!org) return null;
      org.projectsShared = org.projectsShared || [];
      const existing = org.projectsShared.find((p) => p.projectId === projectId);
      if (existing) existing.role = role;
      else org.projectsShared.push({ projectId, role, sharedAt: new Date().toISOString() });
      db.write(data);
      return org.projectsShared;
    }
  };
}
