/**
 * Hand-written, kept in step with `supabase/migrations/`. Once the full §8
 * schema lands, replace this file wholesale with:
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
      players: {
        Row: {
          id: number;
          sleeper_id: string | null;
          full_name: string;
          search_name: string;
          position: string | null;
          nfl_team: string | null;
          age: number | null;
          years_exp: number | null;
          status: string | null;
          injury_status: string | null;
          headshot_url: string | null;
          birth_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          sleeper_id?: string | null;
          full_name: string;
          search_name: string;
          position?: string | null;
          nfl_team?: string | null;
          age?: number | null;
          years_exp?: number | null;
          status?: string | null;
          injury_status?: string | null;
          headshot_url?: string | null;
          birth_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["players"]["Insert"]>;
        Relationships: [];
      };
      player_crosswalk: {
        Row: {
          player_id: number;
          source: string;
          source_id: string;
          match_method: string;
          confidence: number;
          created_at: string;
        };
        Insert: {
          player_id: number;
          source: string;
          source_id: string;
          match_method: string;
          confidence: number;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["player_crosswalk"]["Insert"]
        >;
        Relationships: [];
      };
      player_id_overrides: {
        Row: {
          source: string;
          source_id: string;
          player_id: number;
          created_by: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          source: string;
          source_id: string;
          player_id: number;
          created_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["player_id_overrides"]["Insert"]
        >;
        Relationships: [];
      };
      unmatched_players: {
        Row: {
          id: string;
          league_id: string;
          yahoo_player_id: string;
          payload: Json;
          resolved_at: string | null;
          resolved_player_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          yahoo_player_id: string;
          payload: Json;
          resolved_at?: string | null;
          resolved_player_id?: number | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["unmatched_players"]["Insert"]
        >;
        Relationships: [];
      };
      rosters: {
        Row: {
          team_id: string;
          player_id: number;
          slot: string | null;
          is_starter: boolean;
          yahoo_player_id: string | null;
          updated_at: string;
        };
        Insert: {
          team_id: string;
          player_id: number;
          slot?: string | null;
          is_starter?: boolean;
          yahoo_player_id?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["rosters"]["Insert"]>;
        Relationships: [];
      };
      player_values: {
        Row: {
          player_id: number;
          league_id: string;
          value: number;
          base_value: number | null;
          value_source: string;
          confidence: number | null;
          overall_rank: number | null;
          position_rank: number | null;
          trend_30d: number | null;
          tier: number | null;
          computed_at: string;
        };
        Insert: {
          player_id: number;
          league_id: string;
          value: number;
          base_value?: number | null;
          value_source: string;
          confidence?: number | null;
          overall_rank?: number | null;
          position_rank?: number | null;
          trend_30d?: number | null;
          tier?: number | null;
          computed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["player_values"]["Insert"]>;
        Relationships: [];
      };
      player_stats: {
        Row: {
          player_id: number;
          season: number;
          week: number;
          stats: Json;
          pts_ppr: number | null;
        };
        Insert: {
          player_id: number;
          season: number;
          week?: number;
          stats?: Json;
          pts_ppr?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["player_stats"]["Insert"]>;
        Relationships: [];
      };
      player_projections: {
        Row: {
          player_id: number;
          season: number;
          week: number;
          stats: Json;
          pts_ppr: number | null;
        };
        Insert: {
          player_id: number;
          season: number;
          week?: number;
          stats?: Json;
          pts_ppr?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["player_projections"]["Insert"]
        >;
        Relationships: [];
      };
      sync_runs: {
        Row: {
          id: string;
          user_id: string;
          league_id: string;
          status: string;
          stages: Json;
          context: Json;
          error: string | null;
          started_at: string;
          finished_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          league_id: string;
          status?: string;
          stages?: Json;
          context?: Json;
          error?: string | null;
          started_at?: string;
          finished_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sync_runs"]["Insert"]>;
        Relationships: [];
      };
      market_values: {
        Row: {
          params_key: string;
          player_id: number;
          value: number;
          overall_rank: number | null;
          position_rank: number | null;
          trend_30d: number | null;
          tier: number | null;
          fetched_at: string;
        };
        Insert: {
          params_key: string;
          player_id: number;
          value: number;
          overall_rank?: number | null;
          position_rank?: number | null;
          trend_30d?: number | null;
          tier?: number | null;
          fetched_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["market_values"]["Insert"]>;
        Relationships: [];
      };
      yahoo_player_pool: {
        Row: {
          league_id: string;
          yahoo_player_id: string;
          team_key: string | null;
          payload: Json;
          fetched_at: string;
        };
        Insert: {
          league_id: string;
          yahoo_player_id: string;
          team_key?: string | null;
          payload: Json;
          fetched_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["yahoo_player_pool"]["Insert"]
        >;
        Relationships: [];
      };
      matchups: {
        Row: {
          league_id: string;
          week: number;
          team_a: string;
          team_b: string | null;
          points_a: number | null;
          points_b: number | null;
          projected_a: number | null;
          projected_b: number | null;
          status: string | null;
          is_playoffs: boolean;
          updated_at: string;
        };
        Insert: {
          league_id: string;
          week: number;
          team_a: string;
          team_b?: string | null;
          points_a?: number | null;
          points_b?: number | null;
          projected_a?: number | null;
          projected_b?: number | null;
          status?: string | null;
          is_playoffs?: boolean;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["matchups"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      /** Phase 3 read model: values joined to identity and league ownership. */
      league_player_values: {
        Row: {
          league_id: string;
          player_id: number;
          value: number;
          base_value: number | null;
          value_source: string;
          confidence: number | null;
          overall_rank: number | null;
          position_rank: number | null;
          trend_30d: number | null;
          tier: number | null;
          computed_at: string;
          full_name: string;
          position: string | null;
          nfl_team: string | null;
          injury_status: string | null;
          headshot_url: string | null;
          projected_pts_ppr: number | null;
          slot: string | null;
          is_starter: boolean | null;
          team_id: string | null;
          team_name: string | null;
          is_users_team: boolean | null;
        };
        Relationships: [];
      };
    };
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
