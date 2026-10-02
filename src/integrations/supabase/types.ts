export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_steps: {
        Row: {
          agent: string
          attempts: number
          completion_tokens: number | null
          created_at: string
          error: string | null
          gateway_run_id: string | null
          id: string
          input: Json | null
          label: string | null
          latency_ms: number | null
          model: string | null
          output: Json | null
          prompt_tokens: number | null
          round: number
          run_id: string
          status: string
          user_id: string
        }
        Insert: {
          agent: string
          attempts?: number
          completion_tokens?: number | null
          created_at?: string
          error?: string | null
          gateway_run_id?: string | null
          id?: string
          input?: Json | null
          label?: string | null
          latency_ms?: number | null
          model?: string | null
          output?: Json | null
          prompt_tokens?: number | null
          round?: number
          run_id: string
          status?: string
          user_id?: string
        }
        Update: {
          agent?: string
          attempts?: number
          completion_tokens?: number | null
          created_at?: string
          error?: string | null
          gateway_run_id?: string | null
          id?: string
          input?: Json | null
          label?: string | null
          latency_ms?: number | null
          model?: string | null
          output?: Json | null
          prompt_tokens?: number | null
          round?: number
          run_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          agent: string
          changed_lines: number
          code: string
          created_at: string
          disqualified: boolean
          disqualify_reason: string | null
          explanation: string | null
          final_score: number | null
          id: string
          is_winner: boolean
          reviewer: Json | null
          round: number
          run_id: string
          scores: Json | null
          user_id: string
        }
        Insert: {
          agent: string
          changed_lines?: number
          code: string
          created_at?: string
          disqualified?: boolean
          disqualify_reason?: string | null
          explanation?: string | null
          final_score?: number | null
          id?: string
          is_winner?: boolean
          reviewer?: Json | null
          round?: number
          run_id: string
          scores?: Json | null
          user_id?: string
        }
        Update: {
          agent?: string
          changed_lines?: number
          code?: string
          created_at?: string
          disqualified?: boolean
          disqualify_reason?: string | null
          explanation?: string | null
          final_score?: number | null
          id?: string
          is_winner?: boolean
          reviewer?: Json | null
          round?: number
          run_id?: string
          scores?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      demos: {
        Row: {
          bug_report: string
          code: string
          description: string
          difficulty: string
          entry_function: string
          id: string
          slug: string
          sort: number
          title: string
        }
        Insert: {
          bug_report: string
          code: string
          description: string
          difficulty: string
          entry_function: string
          id?: string
          slug: string
          sort?: number
          title: string
        }
        Update: {
          bug_report?: string
          code?: string
          description?: string
          difficulty?: string
          entry_function?: string
          id?: string
          slug?: string
          sort?: number
          title?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          default_baseline: boolean
          default_max_rounds: number
          default_timeout_ms: number
          display_name: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_baseline?: boolean
          default_max_rounds?: number
          default_timeout_ms?: number
          display_name?: string | null
          id?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          default_baseline?: boolean
          default_max_rounds?: number
          default_timeout_ms?: number
          display_name?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      reputation: {
        Row: {
          agent: string
          attacks_landed: number
          id: string
          losses: number
          updated_at: string
          user_id: string
          value: number
          wins: number
        }
        Insert: {
          agent: string
          attacks_landed?: number
          id?: string
          losses?: number
          updated_at?: string
          user_id?: string
          value?: number
          wins?: number
        }
        Update: {
          agent?: string
          attacks_landed?: number
          id?: string
          losses?: number
          updated_at?: string
          user_id?: string
          value?: number
          wins?: number
        }
        Relationships: []
      }
      reputation_history: {
        Row: {
          agent: string
          created_at: string
          delta: number
          id: string
          reason: string
          run_id: string | null
          user_id: string
          value_after: number
        }
        Insert: {
          agent: string
          created_at?: string
          delta: number
          id?: string
          reason: string
          run_id?: string | null
          user_id?: string
          value_after: number
        }
        Update: {
          agent?: string
          created_at?: string
          delta?: number
          id?: string
          reason?: string
          run_id?: string | null
          user_id?: string
          value_after?: number
        }
        Relationships: [
          {
            foreignKeyName: "reputation_history_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          baseline_enabled: boolean
          best_score: number | null
          bug_report: string
          code: string
          created_at: string
          current_round: number
          duration_ms: number
          entry_function: string | null
          error: string | null
          id: string
          max_rounds: number
          patchers: Json
          phase: string | null
          reference_implementation: string | null
          reproducer_retries: number
          reputation_applied: boolean
          share_token: string | null
          status: string
          timeout_ms: number
          title: string
          total_tokens: number
          triage: Json | null
          updated_at: string
          user_id: string
          verdict_markdown: string | null
          winner_candidate_id: string | null
        }
        Insert: {
          baseline_enabled?: boolean
          best_score?: number | null
          bug_report: string
          code: string
          created_at?: string
          current_round?: number
          duration_ms?: number
          entry_function?: string | null
          error?: string | null
          id?: string
          max_rounds?: number
          patchers?: Json
          phase?: string | null
          reference_implementation?: string | null
          reproducer_retries?: number
          reputation_applied?: boolean
          share_token?: string | null
          status?: string
          timeout_ms?: number
          title: string
          total_tokens?: number
          triage?: Json | null
          updated_at?: string
          user_id?: string
          verdict_markdown?: string | null
          winner_candidate_id?: string | null
        }
        Update: {
          baseline_enabled?: boolean
          best_score?: number | null
          bug_report?: string
          code?: string
          created_at?: string
          current_round?: number
          duration_ms?: number
          entry_function?: string | null
          error?: string | null
          id?: string
          max_rounds?: number
          patchers?: Json
          phase?: string | null
          reference_implementation?: string | null
          reproducer_retries?: number
          reputation_applied?: boolean
          share_token?: string | null
          status?: string
          timeout_ms?: number
          title?: string
          total_tokens?: number
          triage?: Json | null
          updated_at?: string
          user_id?: string
          verdict_markdown?: string | null
          winner_candidate_id?: string | null
        }
        Relationships: []
      }
      test_results: {
        Row: {
          candidate_id: string | null
          console: Json | null
          created_at: string
          duration_ms: number | null
          id: string
          message: string | null
          run_id: string
          status: string
          target: string
          test_id: string
          user_id: string
        }
        Insert: {
          candidate_id?: string | null
          console?: Json | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          message?: string | null
          run_id: string
          status: string
          target?: string
          test_id: string
          user_id?: string
        }
        Update: {
          candidate_id?: string | null
          console?: Json | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          message?: string | null
          run_id?: string
          status?: string
          target?: string
          test_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_results_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      tests: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          rationale: string | null
          round_created: number
          run_id: string
          source: string
          target_candidate_id: string | null
          user_id: string
          valid_on_reference: boolean | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          name: string
          rationale?: string | null
          round_created?: number
          run_id: string
          source: string
          target_candidate_id?: string | null
          user_id?: string
          valid_on_reference?: boolean | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          rationale?: string | null
          round_created?: number
          run_id?: string
          source?: string
          target_candidate_id?: string | null
          user_id?: string
          valid_on_reference?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "tests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_shared_run: { Args: { _token: string }; Returns: Json }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
