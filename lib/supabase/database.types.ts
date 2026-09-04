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
      espn_credentials: {
        Row: {
          user_id: string;
          swid_enc: string;
          espn_s2_enc: string;
          needs_reauth: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          swid_enc: string;
          espn_s2_enc: string;
          needs_reauth?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          swid_enc?: string;
          espn_s2_enc?: string;
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
          /** 'yahoo' / 'espn' when imported over that API, 'manual' when typed in. */
          source: string;
          /** Yahoo's key, `espn:<season>:<leagueId>`, or `manual:<uuid>`. */
          yahoo_league_key: string;
          yahoo_game_key: string | null;
          name: string;
          /** True once the user renamed it; sync then leaves `name` alone. */
          name_overridden: boolean;
          /** What the provider last called it. Null on a manual league. */
          provider_name: string | null;
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
          source?: string;
          name_overridden?: boolean;
          provider_name?: string | null;
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
          ros_points: number | null;
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
          ros_points?: number | null;
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
      stat_coverage: {
        Row: {
          season: number;
          week: number;
          kind: string;
          players: number;
          fetched_at: string;
        };
        Insert: {
          season: number;
          week: number;
          kind: string;
          players?: number;
          fetched_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["stat_coverage"]["Insert"]
        >;
        Relationships: [];
      };
      league_settings: {
        Row: {
          league_id: string;
          alpha: number;
          beta: number;
          gamma: number;
          lambda: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          league_id: string;
          alpha?: number;
          beta?: number;
          gamma?: number;
          lambda?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["league_settings"]["Insert"]
        >;
        Relationships: [];
      };
      saved_trades: {
        Row: {
          id: string;
          user_id: string;
          league_id: string;
          payload: Json;
          verdict: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          league_id: string;
          payload: Json;
          verdict: string;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["saved_trades"]["Insert"]>;
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
      team_needs: {
        Row: {
          team_id: string;
          position: string;
          strength: number;
          z_score: number;
          need: number;
          surplus: number;
          surplus_z: number;
          confidence: number;
          computed_at: string;
        };
        Insert: {
          team_id: string;
          position: string;
          strength: number;
          z_score: number;
          need: number;
          surplus: number;
          surplus_z: number;
          confidence?: number;
          computed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_needs"]["Insert"]>;
        Relationships: [];
      };
      trade_suggestions: {
        Row: {
          id: string;
          league_id: string;
          team_a: string;
          team_b: string;
          payload: Json;
          score: number;
          band: string;
          rank: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          team_a: string;
          team_b: string;
          payload: Json;
          score: number;
          band: string;
          rank: number;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["trade_suggestions"]["Insert"]
        >;
        Relationships: [];
      };
      /** Phase 9: three-team cycles, one ranked menu per team (§7 Req. 11). */
      cycle_suggestions: {
        Row: {
          id: string;
          league_id: string;
          anchor_team: string;
          payload: Json;
          score: number;
          band: string;
          rank: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          anchor_team: string;
          payload: Json;
          score: number;
          band: string;
          rank: number;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["cycle_suggestions"]["Insert"]
        >;
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          league_id: string;
          kind: string;
          occurred_at: string;
          week: number | null;
          faab_bid: number | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          kind: string;
          occurred_at?: string;
          week?: number | null;
          faab_bid?: number | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["transactions"]["Insert"]>;
        Relationships: [];
      };
      transaction_items: {
        Row: {
          id: string;
          transaction_id: string;
          player_id: number;
          /** null means the player came from the free-agent pool. */
          from_team_id: string | null;
          /** null means the player was cut back to it. */
          to_team_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          transaction_id: string;
          player_id: number;
          from_team_id?: string | null;
          to_team_id?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["transaction_items"]["Insert"]
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
          ros_points: number | null;
          computed_at: string;
          full_name: string;
          position: string | null;
          nfl_team: string | null;
          injury_status: string | null;
          /** Yahoo's free-text reason ("Knee"). Label only -- never valued. */
          injury_note: string | null;
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
      /**
       * Phase 7 read model: what a league has available, priced. Yahoo's own
       * list where there is one; everything unrostered on a manual league.
       */
      league_free_agents: {
        Row: {
          league_id: string;
          player_id: number;
          value: number;
          value_source: string;
          confidence: number | null;
          position_rank: number | null;
          ros_points: number | null;
          computed_at: string;
          full_name: string;
          position: string | null;
          nfl_team: string | null;
          injury_status: string | null;
          /** Yahoo's free-text reason ("Knee"). Null on a manual league. */
          injury_note: string | null;
          headshot_url: string | null;
          projected_pts_ppr: number | null;
          /** The pool fetch, or the valuation run on a manual league. */
          fetched_at: string;
        };
        Relationships: [];
      };
    };
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
