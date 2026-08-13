// Public API for the `admin` domain module (ENGINEERING-02A boundary).
// Consumers import only from `@/modules/admin` — never deep internal paths.
export { grantSupportAccess } from './application/grant-support-access';
export { revokeSupportAccess } from './application/revoke-support-access';
export { inviteMember } from './application/invite-member';
export { AdminRepository } from './repository/admin-repository';
export type {
  GrantSupportAccessInput,
  RevokeSupportAccessInput,
  InviteMemberInput,
  GrantContext,
  RevokeContext,
  InvitableRole,
} from './domain/types';
