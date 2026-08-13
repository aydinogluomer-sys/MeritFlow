'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ExportAuditSchema } from '@/lib/validation/schemas/audit';
import { requirePermission, getPermissions } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createAdminClient } from '@/lib/supabase/admin';
import { exportAudit as exportAuditModule, CompAccessRepository } from '@/modules/audit';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces audit.read and resolves AD3 visibility
 * HERE (canSeeRaw = audit.read AND comp.read), then delegates to the audit module. The admin
 * client (for the fail-closed log_comp_access RPC) is created HERE and injected. Behavior
 * (masking, conditional comp-access audit, CSV shape) unchanged.
 */
export const exportAudit = validatedAction(ExportAuditSchema, async (input) => {
  await requirePermission('audit.read');
  const org = await getActiveOrg();
  const permissions = await getPermissions();
  const canSeeRaw = permissions.includes('audit.read') && permissions.includes('comp.read');

  const compAccessRepo = new CompAccessRepository(createAdminClient());
  return exportAuditModule(
    input,
    { organizationId: org!.organization_id, actorProfileId: org!.profile_id, canSeeRaw },
    compAccessRepo,
  );
});
