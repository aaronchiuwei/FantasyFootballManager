/**
 * Hand-written for the Phase 0 schema. Once the full schema lands (§8), replace
 * this file wholesale with:
 *
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/database.types.ts
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      yahoo_tokens: {
        Row: {
          user_id: string;
          access_token_enc: string;
          refresh_token_enc: string;
          expires_at: string;
          yahoo_guid: string | null;
          needs_reauth: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          access_token_enc: string;
          refresh_token_enc: string;
          expires_at: string;
          yahoo_guid?: string | null;
          needs_reauth?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          access_token_enc?: string;
          refresh_token_enc?: string;
          expires_at?: string;
          yahoo_guid?: string | null;
          needs_reauth?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leagues: {
        Row: {
          id: string;
          user_id: string;
          yahoo_league_key: string;
          yahoo_game_key: string | null;
          name: string;
          season: number;
          num_teams: number | null;
          scoring_type: string | null;
          ppr: number;
          num_qbs: number;
          roster_slots: Json;
          is_dynasty: boolean;
          current_week: number | null;
          start_week: number | null;
          end_week: number | null;
          logo_url: string | null;
          url: string | null;
          is_finished: boolean;
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          yahoo_league_key: string;
          yahoo_game_key?: string | null;
          name: string;
          season: number;
          num_teams?: number | null;
          scoring_type?: string | null;
          ppr?: number;
          num_qbs?: number;
          roster_slots?: Json;
          is_dynasty?: boolean;
          current_week?: number | null;
          start_week?: number | null;
          end_week?: number | null;
          logo_url?: string | null;
          url?: string | null;
          is_finished?: boolean;
          last_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["leagues"]["Insert"]>;
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          league_id: string;
          yahoo_team_key: string;
          yahoo_team_id: number | null;
          name: string;
          manager_name: string | null;
          logo_url: string | null;
          is_users_team: boolean;
          wins: number | null;
          losses: number | null;
          ties: number | null;
          points_for: number | null;
          points_against: number | null;
          rank: number | null;
          playoff_seed: number | null;
          waiver_priority: number | null;
          faab_balance: number | null;
          number_of_moves: number | null;
          number_of_trades: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          yahoo_team_key: string;
          yahoo_team_id?: number | null;
          name: string;
          manager_name?: string | null;
          logo_url?: string | null;
          is_users_team?: boolean;
          wins?: number | null;
          losses?: number | null;
          ties?: number | null;
          points_for?: number | null;
          points_against?: number | null;
          rank?: number | null;
          playoff_seed?: number | null;
          waiver_priority?: number | null;
          faab_balance?: number | null;
          number_of_moves?: number | null;
          number_of_trades?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["teams"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
