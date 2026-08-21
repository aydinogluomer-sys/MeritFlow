// Tasks data-access. Wraps the RLS-enforced user client (never the service-role admin
// client — AD1 / boundary test). The exact client type is taken from createClient via a
// type-only import so it always matches `await createClient()`.
import { toDomainError } from '@/lib/errors';
import type { TablesInsert } from '@/types/database.generated';

type ServerClient = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

export class TaskRepository {
  constructor(private readonly supabase: ServerClient) {}

  /** Latest PUBLISHED scoring policy version id for the org (AD7), or null when none. */
  async publishedScoringPolicyVersionId(organizationId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('scoring_policy_versions')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('status', 'published')
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? (data as { id: string }).id : null;
  }

  /** Insert a task row; returns the new id. */
  async insert(row: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.supabase
      .from('tasks')
      .insert(row as TablesInsert<'tasks'>)
      .select('id')
      .single();
    if (error) throw toDomainError(error);
    return (data as { id: string }).id;
  }

  /** in_progress → submitted for the task (RLS restricts the update to the assignee). */
  async markSubmitted(taskId: string, organizationId: string): Promise<void> {
    const { error } = await this.supabase
      .from('tasks')
      .update({ status: 'submitted' })
      .eq('id', taskId)
      .eq('status', 'in_progress')
      .eq('organization_id', organizationId);
    if (error) throw toDomainError(error);
  }
}
