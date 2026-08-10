import { z } from 'zod';

export const GrantSupportAccessSchema = z.object({
  granteeId: z.string().uuid(),
  scope: z.string().min(1).max(500),
  reason: z.string().min(5).max(1000),
  expiresAt: z.string().datetime(),
});

export const RevokeSupportAccessSchema = z.object({
  grantId: z.string().uuid(),
});
