export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      anti_gaming_flags: {
        Row: {
          bonus_period_id: string | null
          created_at: string
          evidence: Json
          id: string
          organization_id: string
          related_reviewer_id: string | null
          related_task_id: string | null
          review_note: string | null
          reviewed_by: string | null
          rule: string
          status: string
          subject_employee_id: string
          updated_at: string
        }
        Insert: {
          bonus_period_id?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          organization_id: string
          related_reviewer_id?: string | null
          related_task_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          rule: string
          status?: string
          subject_employee_id: string
          updated_at?: string
        }
        Update: {
          bonus_period_id?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          organization_id?: string
          related_reviewer_id?: string | null
          related_task_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          rule?: string
          status?: string
          subject_employee_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anti_gaming_flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anti_gaming_flags_reviewed_by_org_fk"
            columns: ["organization_id", "reviewed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "anti_gaming_flags_reviewer_org_fk"
            columns: ["organization_id", "related_reviewer_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "anti_gaming_flags_subject_org_fk"
            columns: ["organization_id", "subject_employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          is_sensitive: boolean
          organization_id: string
          reason: string | null
          request_context: Json | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          is_sensitive?: boolean
          organization_id: string
          reason?: string | null
          request_context?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          is_sensitive?: boolean
          organization_id?: string
          reason?: string | null
          request_context?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_allocation_snapshots: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bonus_period_id: string
          bonus_pool_id: string
          calculation_metadata: Json
          calculation_run_id: string
          created_at: string
          id: string
          organization_id: string
          policy_version_id: string | null
          t_org: number | null
          top_up_applied: boolean
          undistributed_remainder_minor: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bonus_period_id: string
          bonus_pool_id: string
          calculation_metadata?: Json
          calculation_run_id: string
          created_at?: string
          id?: string
          organization_id: string
          policy_version_id?: string | null
          t_org?: number | null
          top_up_applied?: boolean
          undistributed_remainder_minor?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bonus_period_id?: string
          bonus_pool_id?: string
          calculation_metadata?: Json
          calculation_run_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          policy_version_id?: string | null
          t_org?: number | null
          top_up_applied?: boolean
          undistributed_remainder_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "bonus_allocation_snapshots_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_allocation_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_allocation_snapshots_period_org_fk"
            columns: ["bonus_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_allocation_snapshots_policy_org_fk"
            columns: ["policy_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "scoring_policy_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_allocation_snapshots_pool_org_fk"
            columns: ["bonus_pool_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_pools"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_allocation_snapshots_run_org_fk"
            columns: ["calculation_run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_calculation_runs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      bonus_allocations: {
        Row: {
          adjusted_score: number
          bonus_period_id: string
          calculation_run_id: string
          cap_applied: string
          cap_basis_minor: number | null
          cap_minor: number | null
          created_at: string
          employee_id: string
          factors: Json
          final_amount_minor: number
          id: string
          organization_id: string
          primary_team_id: string | null
          raw_share_minor: number
          rounding_adjustment_minor: number
          status: string
          updated_at: string
        }
        Insert: {
          adjusted_score: number
          bonus_period_id: string
          calculation_run_id: string
          cap_applied?: string
          cap_basis_minor?: number | null
          cap_minor?: number | null
          created_at?: string
          employee_id: string
          factors?: Json
          final_amount_minor: number
          id?: string
          organization_id: string
          primary_team_id?: string | null
          raw_share_minor: number
          rounding_adjustment_minor?: number
          status?: string
          updated_at?: string
        }
        Update: {
          adjusted_score?: number
          bonus_period_id?: string
          calculation_run_id?: string
          cap_applied?: string
          cap_basis_minor?: number | null
          cap_minor?: number | null
          created_at?: string
          employee_id?: string
          factors?: Json
          final_amount_minor?: number
          id?: string
          organization_id?: string
          primary_team_id?: string | null
          raw_share_minor?: number
          rounding_adjustment_minor?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_allocations_employee_org_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "bonus_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_allocations_period_org_fk"
            columns: ["bonus_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_allocations_run_org_fk"
            columns: ["calculation_run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_calculation_runs"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_allocations_team_org_fk"
            columns: ["primary_team_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      bonus_calculation_runs: {
        Row: {
          bonus_period_id: string
          bonus_pool_id: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          notes: string | null
          organization_id: string
          policy_version_id: string | null
          status: string
          superseded_by: string | null
          t_org: number | null
          top_up_applied: boolean
          triggered_by: string
          updated_at: string
        }
        Insert: {
          bonus_period_id: string
          bonus_pool_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          notes?: string | null
          organization_id: string
          policy_version_id?: string | null
          status?: string
          superseded_by?: string | null
          t_org?: number | null
          top_up_applied?: boolean
          triggered_by: string
          updated_at?: string
        }
        Update: {
          bonus_period_id?: string
          bonus_pool_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          notes?: string | null
          organization_id?: string
          policy_version_id?: string | null
          status?: string
          superseded_by?: string | null
          t_org?: number | null
          top_up_applied?: boolean
          triggered_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_calculation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_calculation_runs_period_org_fk"
            columns: ["bonus_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_calculation_runs_policy_org_fk"
            columns: ["policy_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "scoring_policy_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_calculation_runs_pool_org_fk"
            columns: ["bonus_pool_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_pools"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_calculation_runs_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "bonus_calculation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_calculation_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_ledger: {
        Row: {
          account: string
          amount_minor: number
          bonus_pool_id: string
          calculation_run_id: string | null
          created_at: string
          created_by: string
          currency: string
          employee_id: string | null
          entry_type: string
          event_type: string
          export_id: string | null
          id: string
          metadata: Json
          organization_id: string
          reason: string | null
          snapshot_id: string | null
          transaction_id: string
        }
        Insert: {
          account: string
          amount_minor: number
          bonus_pool_id: string
          calculation_run_id?: string | null
          created_at?: string
          created_by: string
          currency?: string
          employee_id?: string | null
          entry_type: string
          event_type: string
          export_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          reason?: string | null
          snapshot_id?: string | null
          transaction_id: string
        }
        Update: {
          account?: string
          amount_minor?: number
          bonus_pool_id?: string
          calculation_run_id?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          employee_id?: string | null
          entry_type?: string
          event_type?: string
          export_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          reason?: string | null
          snapshot_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_ledger_employee_org_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "bonus_ledger_export_org_fk"
            columns: ["export_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exports"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_ledger_pool_org_fk"
            columns: ["bonus_pool_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_pools"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_ledger_run_org_fk"
            columns: ["calculation_run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_calculation_runs"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_ledger_snapshot_org_fk"
            columns: ["snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_allocation_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      bonus_periods: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          ends_on: string
          id: string
          locked_at: string | null
          locked_by: string | null
          organization_id: string
          period_type: string
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          ends_on: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          organization_id: string
          period_type?: string
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          ends_on?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          organization_id?: string
          period_type?: string
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_periods_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_pool_components: {
        Row: {
          bonus_pool_id: string
          component: string
          created_at: string
          created_by: string
          id: string
          organization_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          bonus_pool_id: string
          component: string
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          updated_at?: string
          weight: number
        }
        Update: {
          bonus_pool_id?: string
          component?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "bonus_pool_components_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pool_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pool_components_pool_org_fk"
            columns: ["bonus_pool_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_pools"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      bonus_pool_eligibility: {
        Row: {
          bonus_pool_id: string
          created_at: string
          created_by: string | null
          days_active: number
          eligibility_factor: number
          eligible: boolean
          employee_id: string
          id: string
          organization_id: string
          primary_team_id: string | null
          proration_factor: number | null
          reason: string | null
          updated_at: string
        }
        Insert: {
          bonus_pool_id: string
          created_at?: string
          created_by?: string | null
          days_active: number
          eligibility_factor: number
          eligible: boolean
          employee_id: string
          id?: string
          organization_id: string
          primary_team_id?: string | null
          proration_factor?: number | null
          reason?: string | null
          updated_at?: string
        }
        Update: {
          bonus_pool_id?: string
          created_at?: string
          created_by?: string | null
          days_active?: number
          eligibility_factor?: number
          eligible?: boolean
          employee_id?: string
          id?: string
          organization_id?: string
          primary_team_id?: string | null
          proration_factor?: number | null
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_pool_eligibility_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pool_eligibility_employee_org_fk"
            columns: ["organization_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "bonus_pool_eligibility_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pool_eligibility_pool_org_fk"
            columns: ["bonus_pool_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_pools"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bonus_pool_eligibility_team_org_fk"
            columns: ["primary_team_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      bonus_pools: {
        Row: {
          amount_minor: number
          bonus_period_id: string
          created_at: string
          created_by: string
          currency: string
          id: string
          locked_at: string | null
          locked_by: string | null
          organization_id: string
          status: string
          t_org: number | null
          top_up_approved: boolean
          updated_at: string
          version_no: number
        }
        Insert: {
          amount_minor: number
          bonus_period_id: string
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          organization_id: string
          status?: string
          t_org?: number | null
          top_up_approved?: boolean
          updated_at?: string
          version_no?: number
        }
        Update: {
          amount_minor?: number
          bonus_period_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          organization_id?: string
          status?: string
          t_org?: number | null
          top_up_approved?: boolean
          updated_at?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "bonus_pools_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pools_locked_by_fk"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pools_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pools_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_pools_period_org_fk"
            columns: ["bonus_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_periods"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      command_log: {
        Row: {
          actor_id: string | null
          command_id: string
          created_at: string
          id: string
          operation_type: string
          organization_id: string
        }
        Insert: {
          actor_id?: string | null
          command_id: string
          created_at?: string
          id?: string
          operation_type: string
          organization_id: string
        }
        Update: {
          actor_id?: string | null
          command_id?: string
          created_at?: string
          id?: string
          operation_type?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "command_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compensation_records: {
        Row: {
          cap_basis_minor: number | null
          created_at: string
          created_by: string
          currency: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          gross_salary_minor: number
          id: string
          notes: string | null
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          cap_basis_minor?: number | null
          created_at?: string
          created_by: string
          currency?: string
          effective_from: string
          effective_to?: string | null
          employee_id: string
          gross_salary_minor: number
          id?: string
          notes?: string | null
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          cap_basis_minor?: number | null
          created_at?: string
          created_by?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          gross_salary_minor?: number
          id?: string
          notes?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compensation_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compensation_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compensation_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dispute_events: {
        Row: {
          actor_id: string
          created_at: string
          dispute_id: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json
          note: string | null
          organization_id: string
          to_status: string | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          dispute_id: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          organization_id: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          dispute_id?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          organization_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispute_events_actor_org_fk"
            columns: ["organization_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "dispute_events_dispute_org_fk"
            columns: ["dispute_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "dispute_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          assigned_reviewer_id: string | null
          complainant_id: string
          created_at: string
          decision_note: string | null
          decision_owner_id: string | null
          dispute_type: string
          due_at: string | null
          id: string
          opened_at: string
          organization_id: string
          resolution: string | null
          resolved_at: string | null
          status: string
          target_id: string
          target_type: string
          updated_at: string
        }
        Insert: {
          assigned_reviewer_id?: string | null
          complainant_id: string
          created_at?: string
          decision_note?: string | null
          decision_owner_id?: string | null
          dispute_type: string
          due_at?: string | null
          id?: string
          opened_at?: string
          organization_id: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          target_id: string
          target_type: string
          updated_at?: string
        }
        Update: {
          assigned_reviewer_id?: string | null
          complainant_id?: string
          created_at?: string
          decision_note?: string | null
          decision_owner_id?: string | null
          dispute_type?: string
          due_at?: string | null
          id?: string
          opened_at?: string
          organization_id?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          target_id?: string
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_complainant_org_fk"
            columns: ["organization_id", "complainant_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "disputes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_owner_org_fk"
            columns: ["organization_id", "decision_owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "disputes_reviewer_org_fk"
            columns: ["organization_id", "assigned_reviewer_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
        ]
      }
      exports: {
        Row: {
          bonus_period_id: string
          checksum: string | null
          created_at: string
          exported_by: string
          file_path: string | null
          format: string
          id: string
          organization_id: string
          row_count: number | null
          snapshot_id: string
          status: string
        }
        Insert: {
          bonus_period_id: string
          checksum?: string | null
          created_at?: string
          exported_by: string
          file_path?: string | null
          format: string
          id?: string
          organization_id: string
          row_count?: number | null
          snapshot_id: string
          status?: string
        }
        Update: {
          bonus_period_id?: string
          checksum?: string | null
          created_at?: string
          exported_by?: string
          file_path?: string | null
          format?: string
          id?: string
          organization_id?: string
          row_count?: number | null
          snapshot_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "exports_exported_by_org_fk"
            columns: ["organization_id", "exported_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "exports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_period_org_fk"
            columns: ["organization_id", "bonus_period_id"]
            isOneToOne: false
            referencedRelation: "bonus_periods"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "exports_snapshot_org_fk"
            columns: ["organization_id", "snapshot_id"]
            isOneToOne: false
            referencedRelation: "bonus_allocation_snapshots"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          role: string
          status?: string
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          deactivated_at: string | null
          id: string
          invited_by: string | null
          joined_at: string
          organization_id: string
          primary_role: string
          profile_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          id?: string
          invited_by?: string | null
          joined_at?: string
          organization_id: string
          primary_role: string
          profile_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          id?: string
          invited_by?: string | null
          joined_at?: string
          organization_id?: string
          primary_role?: string
          profile_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_primary_role_fkey"
            columns: ["primary_role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          organization_id: string
          payload: Json
          read_at: string | null
          recipient_id: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          organization_id: string
          payload?: Json
          read_at?: string | null
          recipient_id: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          organization_id?: string
          payload?: Json
          read_at?: string | null
          recipient_id?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_org_fk"
            columns: ["organization_id", "recipient_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          anti_gaming_thresholds: Json
          cap_rate_default: number
          created_at: string
          id: string
          leaderboard_visibility: string
          locale: string | null
          organization_id: string
          period_type: string
          updated_at: string
          winner_overlay_enabled: boolean
        }
        Insert: {
          anti_gaming_thresholds?: Json
          cap_rate_default?: number
          created_at?: string
          id?: string
          leaderboard_visibility?: string
          locale?: string | null
          organization_id: string
          period_type?: string
          updated_at?: string
          winner_overlay_enabled?: boolean
        }
        Update: {
          anti_gaming_thresholds?: Json
          cap_rate_default?: number
          created_at?: string
          id?: string
          leaderboard_visibility?: string
          locale?: string | null
          organization_id?: string
          period_type?: string
          updated_at?: string
          winner_overlay_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          currency: string
          id: string
          legal_name: string | null
          locale: string | null
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          legal_name?: string | null
          locale?: string | null
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          legal_name?: string | null
          locale?: string | null
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      outbox_events: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          processed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          max_attempts?: number
          organization_id: string
          payload?: Json
          processed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          max_attempts?: number
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          domain: string
          id: string
          is_sensitive: boolean
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          domain: string
          id?: string
          is_sensitive?: boolean
          key: string
          label: string
        }
        Update: {
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          is_sensitive?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      point_ledger: {
        Row: {
          bonus_period_id: string | null
          created_at: string
          created_by: string
          dispute_id: string | null
          employee_id: string
          event_type: string
          id: string
          metadata: Json | null
          organization_id: string
          points_delta: number
          reason: string
          reverses_entry_id: string | null
          scoring_policy_version_id: string | null
          task_id: string | null
        }
        Insert: {
          bonus_period_id?: string | null
          created_at?: string
          created_by: string
          dispute_id?: string | null
          employee_id: string
          event_type: string
          id?: string
          metadata?: Json | null
          organization_id: string
          points_delta: number
          reason: string
          reverses_entry_id?: string | null
          scoring_policy_version_id?: string | null
          task_id?: string | null
        }
        Update: {
          bonus_period_id?: string | null
          created_at?: string
          created_by?: string
          dispute_id?: string | null
          employee_id?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          points_delta?: number
          reason?: string
          reverses_entry_id?: string | null
          scoring_policy_version_id?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "point_ledger_bonus_period_org_fk"
            columns: ["bonus_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bonus_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "point_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_ledger_dispute_org_fk"
            columns: ["dispute_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "point_ledger_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_ledger_policy_version_fk"
            columns: ["scoring_policy_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "scoring_policy_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "point_ledger_reverses_fk"
            columns: ["reverses_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "point_ledger"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "point_ledger_task_org_fk"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      profiles: {
        Row: {
          alias: string | null
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          locale: string | null
          updated_at: string
        }
        Insert: {
          alias?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          locale?: string | null
          updated_at?: string
        }
        Update: {
          alias?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          locale?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_counters: {
        Row: {
          count: number
          key: string
          organization_id: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          organization_id: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          organization_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          constraint_meta: Json
          created_at: string
          id: string
          permission_key: string
          role_key: string
        }
        Insert: {
          constraint_meta?: Json
          created_at?: string
          id?: string
          permission_key: string
          role_key: string
        }
        Update: {
          constraint_meta?: Json
          created_at?: string
          id?: string
          permission_key?: string
          role_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          label: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      scoring_policies: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_policy_versions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          multipliers: Json
          notes: string | null
          organization_id: string
          published_at: string | null
          published_by: string | null
          revision_penalty_rule: Json
          scoring_policy_id: string
          status: string
          timeliness_thresholds: Json
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          multipliers: Json
          notes?: string | null
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          revision_penalty_rule: Json
          scoring_policy_id: string
          status?: string
          timeliness_thresholds: Json
          version_no: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          multipliers?: Json
          notes?: string | null
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          revision_penalty_rule?: Json
          scoring_policy_id?: string
          status?: string
          timeliness_thresholds?: Json
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_policy_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_policy_versions_policy_org_fk"
            columns: ["scoring_policy_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "scoring_policies"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "scoring_policy_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_access_grants: {
        Row: {
          created_at: string
          expires_at: string
          granted_by: string
          grantee_id: string
          id: string
          organization_id: string
          reason: string | null
          revoked_at: string | null
          scope: string
          status: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          granted_by: string
          grantee_id: string
          id?: string
          organization_id: string
          reason?: string | null
          revoked_at?: string | null
          scope: string
          status?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          granted_by?: string
          grantee_id?: string
          id?: string
          organization_id?: string
          reason?: string | null
          revoked_at?: string | null
          scope?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_access_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_access_grants_grantee_id_fkey"
            columns: ["grantee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json
          organization_id: string
          submitted_at_snapshot: string | null
          task_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          submitted_at_snapshot?: string | null
          task_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          submitted_at_snapshot?: string | null
          task_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_events_actor_org_fk"
            columns: ["organization_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "task_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_org_fk"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      task_reviews: {
        Row: {
          collaboration_score: string | null
          created_at: string
          decision: string
          id: string
          organization_id: string
          quality: string
          reviewer_id: string
          reviewer_note: string | null
          task_id: string
          timeliness: string
          timeliness_override_reason: string | null
        }
        Insert: {
          collaboration_score?: string | null
          created_at?: string
          decision: string
          id?: string
          organization_id: string
          quality: string
          reviewer_id: string
          reviewer_note?: string | null
          task_id: string
          timeliness: string
          timeliness_override_reason?: string | null
        }
        Update: {
          collaboration_score?: string | null
          created_at?: string
          decision?: string
          id?: string
          organization_id?: string
          quality?: string
          reviewer_id?: string
          reviewer_note?: string | null
          task_id?: string
          timeliness?: string
          timeliness_override_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reviews_reviewer_org_fk"
            columns: ["organization_id", "reviewer_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "task_reviews_task_org_fk"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      tasks: {
        Row: {
          acceptance_criteria: string | null
          anomaly_status: string | null
          approved_at: string | null
          assigned_to: string
          base_points: number
          completed_at: string | null
          complexity: string
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          employee_note: string | null
          estimated_effort: string | null
          evidence_required: boolean
          final_points: number | null
          id: string
          impact: string
          last_valid_submitted_at: string | null
          objective_id: string | null
          organization_id: string
          priority: string | null
          project_id: string | null
          rejected_at: string | null
          reviewer_id: string | null
          reviewer_note: string | null
          revision_count: number
          scoring_policy_version_id: string
          status: string
          submitted_at: string | null
          task_type: string | null
          team_id: string
          title: string
          updated_at: string
          urgency: string | null
        }
        Insert: {
          acceptance_criteria?: string | null
          anomaly_status?: string | null
          approved_at?: string | null
          assigned_to: string
          base_points: number
          completed_at?: string | null
          complexity: string
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          employee_note?: string | null
          estimated_effort?: string | null
          evidence_required?: boolean
          final_points?: number | null
          id?: string
          impact: string
          last_valid_submitted_at?: string | null
          objective_id?: string | null
          organization_id: string
          priority?: string | null
          project_id?: string | null
          rejected_at?: string | null
          reviewer_id?: string | null
          reviewer_note?: string | null
          revision_count?: number
          scoring_policy_version_id: string
          status?: string
          submitted_at?: string | null
          task_type?: string | null
          team_id: string
          title: string
          updated_at?: string
          urgency?: string | null
        }
        Update: {
          acceptance_criteria?: string | null
          anomaly_status?: string | null
          approved_at?: string | null
          assigned_to?: string
          base_points?: number
          completed_at?: string | null
          complexity?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          employee_note?: string | null
          estimated_effort?: string | null
          evidence_required?: boolean
          final_points?: number | null
          id?: string
          impact?: string
          last_valid_submitted_at?: string | null
          objective_id?: string | null
          organization_id?: string
          priority?: string | null
          project_id?: string | null
          rejected_at?: string | null
          reviewer_id?: string | null
          reviewer_note?: string | null
          revision_count?: number
          scoring_policy_version_id?: string
          status?: string
          submitted_at?: string | null
          task_type?: string | null
          team_id?: string
          title?: string
          updated_at?: string
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_org_fk"
            columns: ["organization_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "tasks_creator_org_fk"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_policy_org_fk"
            columns: ["scoring_policy_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "scoring_policy_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tasks_reviewer_org_fk"
            columns: ["organization_id", "reviewer_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "profile_id"]
          },
          {
            foreignKeyName: "tasks_team_org_fk"
            columns: ["team_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      team_memberships: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          joined_at: string
          organization_id: string
          profile_id: string
          role_in_team: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          joined_at?: string
          organization_id: string
          profile_id: string
          role_in_team?: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          joined_at?: string
          organization_id?: string
          profile_id?: string
          role_in_team?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          manager_id: string | null
          name: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_id?: string | null
          name: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_id?: string | null
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_finance_payout: {
        Row: {
          bonus_period_id: string | null
          display_name: string | null
          employee_id: string | null
          final_amount_minor: number | null
          paid_amount_minor: number | null
          paid_at: string | null
          status: string | null
        }
        Relationships: []
      }
      v_finance_period_totals: {
        Row: {
          bonus_period_id: string | null
          distributable: number | null
          period_status: string | null
          pool_amount: number | null
          total_accrued: number | null
          total_paid: number | null
          undistributed_remainder: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invitation: {
        Args: { p_display_name: string; p_token: string }
        Returns: string
      }
      apply_dispute_point_adjustment: {
        Args: {
          p_actor: string
          p_bonus_period_id?: string
          p_dispute_id: string
          p_points_delta: number
          p_reason: string
        }
        Returns: string
      }
      apply_manual_point_adjustment: {
        Args: {
          p_actor: string
          p_employee_id: string
          p_organization_id: string
          p_points_delta: number
          p_reason: string
          p_second_approver: string
          p_task_id?: string
        }
        Returns: string
      }
      check_rate_limit: {
        Args: {
          p_key: string
          p_max_requests: number
          p_organization_id: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      claim_command: {
        Args: {
          p_actor_id?: string
          p_command_id: string
          p_operation_type: string
          p_organization_id: string
        }
        Returns: boolean
      }
      claim_outbox_events: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          available_at: string
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          processed_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "outbox_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      compute_final_points: {
        Args: {
          p_base: number
          p_complexity: string
          p_impact: string
          p_multipliers: Json
          p_penalty_rule: Json
          p_quality: string
          p_revision_count: number
          p_timeliness: string
        }
        Returns: number
      }
      create_invitation: {
        Args: { p_email: string; p_role: string }
        Returns: string
      }
      create_organization: {
        Args: { p_display_name: string; p_name: string; p_slug: string }
        Returns: string
      }
      current_org: { Args: never; Returns: string }
      detect_duplicate_task: {
        Args: { p_organization_id: string }
        Returns: number
      }
      detect_period_end_spike: {
        Args: { p_bonus_period_id: string; p_organization_id: string }
        Returns: number
      }
      detect_same_reviewer_concentration: {
        Args: { p_bonus_period_id: string; p_organization_id: string }
        Returns: number
      }
      detect_tiny_task_splitting: {
        Args: { p_organization_id: string }
        Returns: number
      }
      enqueue_outbox_event: {
        Args: {
          p_event_type: string
          p_idempotency_key: string
          p_organization_id: string
          p_payload: Json
        }
        Returns: string
      }
      get_leaderboard: {
        Args: {
          p_organization_id: string
          p_period_end?: string
          p_period_start?: string
        }
        Returns: {
          display_name: string
          is_self: boolean
          rank: number
          total_points: number
        }[]
      }
      has_permission: { Args: { perm_key: string }; Returns: boolean }
      has_role: { Args: { role_key: string }; Returns: boolean }
      has_support_grant: { Args: { p_org: string }; Returns: boolean }
      log_comp_access: {
        Args: {
          p_actor_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: undefined
      }
      manages_team: { Args: { p_team_id: string }; Returns: boolean }
      mark_payout_paid: {
        Args: {
          p_actor: string
          p_bonus_period_id: string
          p_export_id: string
          p_organization_id: string
        }
        Returns: string
      }
      mask_compensation: { Args: { p: Json }; Returns: Json }
      owns_review_decision: { Args: { p_dispute_id: string }; Returns: boolean }
      post_bonus_accrual: {
        Args: {
          p_bonus_period_id: string
          p_organization_id: string
          p_triggered_by: string
        }
        Returns: string
      }
      produce_payout_export: {
        Args: {
          p_actor: string
          p_bonus_period_id: string
          p_format: string
          p_organization_id: string
          p_snapshot_id: string
        }
        Returns: string
      }
      prune_rate_limit_counters: { Args: never; Returns: undefined }
      read_compensation_record: {
        Args: { p_employee: string; p_reason: string }
        Returns: {
          cap_basis_minor: number | null
          created_at: string
          created_by: string
          currency: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          gross_salary_minor: number
          id: string
          notes: string | null
          organization_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "compensation_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recalculate_bonus_after_dispute: {
        Args: {
          p_bonus_period_id: string
          p_organization_id: string
          p_triggered_by: string
        }
        Returns: string
      }
      run_anti_gaming_scan: {
        Args: { p_bonus_period_id?: string; p_organization_id: string }
        Returns: number
      }
      run_bonus_calculation: {
        Args: {
          p_bonus_period_id: string
          p_bonus_pool_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_triggered_by: string
        }
        Returns: string
      }
      shares_org: { Args: { p_profile: string }; Returns: boolean }
      team_of: { Args: { p_employee: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

