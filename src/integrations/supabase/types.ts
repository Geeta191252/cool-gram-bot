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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cg_ads: {
        Row: {
          boost_days: number | null
          budget_left: number
          category: string
          conditions: string | null
          created_at: string
          id: string
          is_active: boolean
          link: string
          owner_tg: number
          reward: number
          src_chat: number | null
          src_msg: number | null
          subtype: string | null
          title: string
        }
        Insert: {
          boost_days?: number | null
          budget_left?: number
          category?: string
          conditions?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          link: string
          owner_tg: number
          reward?: number
          src_chat?: number | null
          src_msg?: number | null
          subtype?: string | null
          title: string
        }
        Update: {
          boost_days?: number | null
          budget_left?: number
          category?: string
          conditions?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          link?: string
          owner_tg?: number
          reward?: number
          src_chat?: number | null
          src_msg?: number | null
          subtype?: string | null
          title?: string
        }
        Relationships: []
      }
      cg_boost_claims: {
        Row: {
          ad_id: string
          created_at: string
          days_claimed: number
          id: string
          last_claim_at: string
          reminded_at: string | null
          status: string
          tg_id: number
          total_days: number
        }
        Insert: {
          ad_id: string
          created_at?: string
          days_claimed?: number
          id?: string
          last_claim_at?: string
          reminded_at?: string | null
          status?: string
          tg_id: number
          total_days?: number
        }
        Update: {
          ad_id?: string
          created_at?: string
          days_claimed?: number
          id?: string
          last_claim_at?: string
          reminded_at?: string | null
          status?: string
          tg_id?: number
          total_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "cg_boost_claims_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "cg_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      cg_completions: {
        Row: {
          ad_id: string
          created_at: string
          id: string
          tg_id: number
        }
        Insert: {
          ad_id: string
          created_at?: string
          id?: string
          tg_id: number
        }
        Update: {
          ad_id?: string
          created_at?: string
          id?: string
          tg_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cg_completions_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "cg_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      cg_cron_tokens: {
        Row: {
          created_at: string
          id: string
          token: string
        }
        Insert: {
          created_at?: string
          id?: string
          token: string
        }
        Update: {
          created_at?: string
          id?: string
          token?: string
        }
        Relationships: []
      }
      cg_settings: {
        Row: {
          key: string
          updated_at: string
          value: number
        }
        Insert: {
          key: string
          updated_at?: string
          value: number
        }
        Update: {
          key?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      cg_star_payments: {
        Row: {
          charge_id: string | null
          created_at: string
          credited: number
          id: string
          stars: number
          tg_id: number
          username: string | null
        }
        Insert: {
          charge_id?: string | null
          created_at?: string
          credited: number
          id?: string
          stars: number
          tg_id: number
          username?: string | null
        }
        Update: {
          charge_id?: string | null
          created_at?: string
          credited?: number
          id?: string
          stars?: number
          tg_id?: number
          username?: string | null
        }
        Relationships: []
      }
      cg_telegram_updates: {
        Row: {
          created_at: string
          update_id: number
        }
        Insert: {
          created_at?: string
          update_id: number
        }
        Update: {
          created_at?: string
          update_id?: number
        }
        Relationships: []
      }
      cg_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          reason: string
          tg_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          reason: string
          tg_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          reason?: string
          tg_id?: number
        }
        Relationships: []
      }
      cg_users: {
        Row: {
          balance: number
          created_at: string
          first_name: string | null
          id: string
          pending_action: string | null
          referral_count: number
          referred_by: number | null
          tg_id: number
          username: string | null
        }
        Insert: {
          balance?: number
          created_at?: string
          first_name?: string | null
          id?: string
          pending_action?: string | null
          referral_count?: number
          referred_by?: number | null
          tg_id: number
          username?: string | null
        }
        Update: {
          balance?: number
          created_at?: string
          first_name?: string | null
          id?: string
          pending_action?: string | null
          referral_count?: number
          referred_by?: number | null
          tg_id?: number
          username?: string | null
        }
        Relationships: []
      }
      cg_withdrawals: {
        Row: {
          amount: number
          created_at: string
          id: string
          resolved_at: string | null
          status: string
          tg_id: number
          username: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          resolved_at?: string | null
          status?: string
          tg_id: number
          username?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          resolved_at?: string | null
          status?: string
          tg_id?: number
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
