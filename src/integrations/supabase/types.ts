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
      prelive_assets: {
        Row: {
          aspect_ratio: string | null
          brief_pdf_path: string | null
          business_key: string | null
          campaign_name: string
          channel: string | null
          created_at: string
          id: string
          key_claims: string[]
          languages: string[]
          latest_version_id: string | null
          mandatory_disclaimers: string[]
          notes: string | null
          owner_id: string | null
          persona: string | null
          target_runtime_sec: number | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          aspect_ratio?: string | null
          brief_pdf_path?: string | null
          business_key?: string | null
          campaign_name: string
          channel?: string | null
          created_at?: string
          id?: string
          key_claims?: string[]
          languages?: string[]
          latest_version_id?: string | null
          mandatory_disclaimers?: string[]
          notes?: string | null
          owner_id?: string | null
          persona?: string | null
          target_runtime_sec?: number | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          aspect_ratio?: string | null
          brief_pdf_path?: string | null
          business_key?: string | null
          campaign_name?: string
          channel?: string | null
          created_at?: string
          id?: string
          key_claims?: string[]
          languages?: string[]
          latest_version_id?: string | null
          mandatory_disclaimers?: string[]
          notes?: string | null
          owner_id?: string | null
          persona?: string | null
          target_runtime_sec?: number | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      prelive_versions: {
        Row: {
          asset_id: string
          change_notes: string | null
          created_at: string
          duration_sec: number | null
          id: string
          playbook_url: string
          qc_task_id: string | null
          resolve_error: string | null
          resolved_thumbnail_url: string | null
          resolved_video_url: string | null
          status: string
          updated_at: string
          version_index: number
          version_label: string
        }
        Insert: {
          asset_id: string
          change_notes?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          playbook_url: string
          qc_task_id?: string | null
          resolve_error?: string | null
          resolved_thumbnail_url?: string | null
          resolved_video_url?: string | null
          status?: string
          updated_at?: string
          version_index: number
          version_label: string
        }
        Update: {
          asset_id?: string
          change_notes?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          playbook_url?: string
          qc_task_id?: string | null
          resolve_error?: string | null
          resolved_thumbnail_url?: string | null
          resolved_video_url?: string | null
          status?: string
          updated_at?: string
          version_index?: number
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "prelive_versions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "prelive_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      qc_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          task_id: string
          timestamp_sec: number | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          task_id: string
          timestamp_sec?: number | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          task_id?: string
          timestamp_sec?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "qc_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_issues: {
        Row: {
          bucket: string
          created_at: string
          criterion: string | null
          description: string | null
          id: string
          severity: string
          suggested_fix: string | null
          task_id: string
          timestamp_sec: number | null
          title: string
        }
        Insert: {
          bucket: string
          created_at?: string
          criterion?: string | null
          description?: string | null
          id?: string
          severity: string
          suggested_fix?: string | null
          task_id: string
          timestamp_sec?: number | null
          title: string
        }
        Update: {
          bucket?: string
          created_at?: string
          criterion?: string | null
          description?: string | null
          id?: string
          severity?: string
          suggested_fix?: string | null
          task_id?: string
          timestamp_sec?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_issues_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "qc_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_tasks: {
        Row: {
          analysis_group_id: string | null
          analysis_summary: string | null
          approval_note: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          brand_score: number | null
          bucket_breakdown: Json
          contextual_score: number | null
          created_at: string
          critical_count: number | null
          customer_intent: string | null
          detected_videos: Json | null
          error_message: string | null
          high_count: number | null
          id: string
          key_frames: Json | null
          low_count: number | null
          media_kind: string | null
          media_url: string | null
          medium_count: number | null
          overall_score: number | null
          owner_id: string | null
          page_markdown: string | null
          page_title: string | null
          prelive_version_id: string | null
          source_kind: string
          status: string
          strategic_score: number | null
          tags: string[]
          technical_score: number | null
          thumbnail_url: string | null
          topic_match_score: number | null
          transcript: Json | null
          transcript_status: string | null
          updated_at: string
          url: string
          video_count: number | null
          video_index: number | null
          video_url: string | null
        }
        Insert: {
          analysis_group_id?: string | null
          analysis_summary?: string | null
          approval_note?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          brand_score?: number | null
          bucket_breakdown?: Json
          contextual_score?: number | null
          created_at?: string
          critical_count?: number | null
          customer_intent?: string | null
          detected_videos?: Json | null
          error_message?: string | null
          high_count?: number | null
          id?: string
          key_frames?: Json | null
          low_count?: number | null
          media_kind?: string | null
          media_url?: string | null
          medium_count?: number | null
          overall_score?: number | null
          owner_id?: string | null
          page_markdown?: string | null
          page_title?: string | null
          prelive_version_id?: string | null
          source_kind?: string
          status?: string
          strategic_score?: number | null
          tags?: string[]
          technical_score?: number | null
          thumbnail_url?: string | null
          topic_match_score?: number | null
          transcript?: Json | null
          transcript_status?: string | null
          updated_at?: string
          url: string
          video_count?: number | null
          video_index?: number | null
          video_url?: string | null
        }
        Update: {
          analysis_group_id?: string | null
          analysis_summary?: string | null
          approval_note?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          brand_score?: number | null
          bucket_breakdown?: Json
          contextual_score?: number | null
          created_at?: string
          critical_count?: number | null
          customer_intent?: string | null
          detected_videos?: Json | null
          error_message?: string | null
          high_count?: number | null
          id?: string
          key_frames?: Json | null
          low_count?: number | null
          media_kind?: string | null
          media_url?: string | null
          medium_count?: number | null
          overall_score?: number | null
          owner_id?: string | null
          page_markdown?: string | null
          page_title?: string | null
          prelive_version_id?: string | null
          source_kind?: string
          status?: string
          strategic_score?: number | null
          tags?: string[]
          technical_score?: number | null
          thumbnail_url?: string | null
          topic_match_score?: number | null
          transcript?: Json | null
          transcript_status?: string | null
          updated_at?: string
          url?: string
          video_count?: number | null
          video_index?: number | null
          video_url?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "reviewer" | "viewer"
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
    Enums: {
      app_role: ["admin", "reviewer", "viewer"],
    },
  },
} as const
