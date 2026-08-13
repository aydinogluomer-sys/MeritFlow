export type InvitableRole = 'employee' | 'manager' | 'hr' | 'finance' | 'auditor';

export interface GrantSupportAccessInput {
  granteeId: string;
  scope: string;
  reason: string;
  expiresAt: string;
}

export interface RevokeSupportAccessInput {
  grantId: string;
}

export interface InviteMemberInput {
  email: string;
  role: InvitableRole;
}

export interface GrantContext {
  organizationId: string;
  userId: string;
}

export interface RevokeContext {
  organizationId: string;
}
