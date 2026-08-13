// Reviews data-access. Wraps the RLS-enforced user client (never the service-role admin
// client — AD1 / boundary test). The client type is taken from createClient via a type-only
// import so it always matches `await createClient()`.
type ServerClient = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

export class ReviewRepository {
  constructor(private readonly supabase: ServerClient) {}

  /** Insert a task_reviews row. Scoring is applied by the DB trigger apply_review_to_task. */
  async insert(row: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.from('task_reviews').insert(row);
    if (error) throw new Error(error.message);
  }
}
