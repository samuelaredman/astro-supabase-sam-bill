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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      collections: {
        Row: {
          id: string
          igdb_id: number | null
          name: string
          slug: string | null
        }
        Insert: {
          id?: string
          igdb_id?: number | null
          name: string
          slug?: string | null
        }
        Update: {
          id?: string
          igdb_id?: number | null
          name?: string
          slug?: string | null
        }
        Relationships: []
      }
      comment_reactions: {
        Row: {
          comment_id: string
          created_at: string | null
          id: string
          profile_id: string
          reaction_type: string
        }
        Insert: {
          comment_id: string
          created_at?: string | null
          id?: string
          profile_id: string
          reaction_type: string
        }
        Update: {
          comment_id?: string
          created_at?: string | null
          id?: string
          profile_id?: string
          reaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "review_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_votes: {
        Row: {
          comment_id: string
          created_at: string | null
          id: string
          profile_id: string
          vote: number
        }
        Insert: {
          comment_id: string
          created_at?: string | null
          id?: string
          profile_id: string
          vote: number
        }
        Update: {
          comment_id?: string
          created_at?: string | null
          id?: string
          profile_id?: string
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "comment_votes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "review_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          profile_id: string | null
          subject: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          profile_id?: string | null
          subject?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          profile_id?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_submissions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      developers: {
        Row: {
          country: string | null
          description: string | null
          founded_year: number | null
          id: string
          igdb_id: number | null
          logo_url: string | null
          name: string
          slug: string
          website_url: string | null
        }
        Insert: {
          country?: string | null
          description?: string | null
          founded_year?: number | null
          id?: string
          igdb_id?: number | null
          logo_url?: string | null
          name: string
          slug: string
          website_url?: string | null
        }
        Update: {
          country?: string | null
          description?: string | null
          founded_year?: number | null
          id?: string
          igdb_id?: number | null
          logo_url?: string | null
          name?: string
          slug?: string
          website_url?: string | null
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string | null
          follower_id: string
          following_id: string
          id: string
          notify: boolean
        }
        Insert: {
          created_at?: string | null
          follower_id: string
          following_id: string
          id?: string
          notify?: boolean
        }
        Update: {
          created_at?: string | null
          follower_id?: string
          following_id?: string
          id?: string
          notify?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_following_id_fkey"
            columns: ["following_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      franchises: {
        Row: {
          id: string
          igdb_id: number | null
          name: string
          slug: string | null
        }
        Insert: {
          id?: string
          igdb_id?: number | null
          name: string
          slug?: string | null
        }
        Update: {
          id?: string
          igdb_id?: number | null
          name?: string
          slug?: string | null
        }
        Relationships: []
      }
      game_collections: {
        Row: {
          collection_id: string
          game_id: string
        }
        Insert: {
          collection_id: string
          game_id: string
        }
        Update: {
          collection_id?: string
          game_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_collections_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_companies: {
        Row: {
          company_id: string
          game_id: string
          role: string
        }
        Insert: {
          company_id: string
          game_id: string
          role: string
        }
        Update: {
          company_id?: string
          game_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_companies_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_franchises: {
        Row: {
          franchise_id: string
          game_id: string
        }
        Insert: {
          franchise_id: string
          game_id: string
        }
        Update: {
          franchise_id?: string
          game_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_franchises_franchise_id_fkey"
            columns: ["franchise_id"]
            isOneToOne: false
            referencedRelation: "franchises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_franchises_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_game_modes: {
        Row: {
          game_id: string
          game_mode_id: string
        }
        Insert: {
          game_id: string
          game_mode_id: string
        }
        Update: {
          game_id?: string
          game_mode_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_game_modes_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_game_modes_game_mode_id_fkey"
            columns: ["game_mode_id"]
            isOneToOne: false
            referencedRelation: "game_modes"
            referencedColumns: ["id"]
          },
        ]
      }
      game_genres: {
        Row: {
          game_id: string
          genre_id: string
        }
        Insert: {
          game_id: string
          genre_id: string
        }
        Update: {
          game_id?: string
          genre_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_genres_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
        ]
      }
      game_modes: {
        Row: {
          id: string
          igdb_id: number | null
          name: string
          slug: string | null
        }
        Insert: {
          id?: string
          igdb_id?: number | null
          name: string
          slug?: string | null
        }
        Update: {
          id?: string
          igdb_id?: number | null
          name?: string
          slug?: string | null
        }
        Relationships: []
      }
      game_platforms: {
        Row: {
          game_id: string
          platform_id: string
        }
        Insert: {
          game_id: string
          platform_id: string
        }
        Update: {
          game_id?: string
          platform_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_platforms_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_platforms_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      game_themes: {
        Row: {
          game_id: string
          theme_id: string
        }
        Insert: {
          game_id: string
          theme_id: string
        }
        Update: {
          game_id?: string
          theme_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_themes_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_themes_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          cover_img_url: string | null
          date_released: string | null
          game_description: string | null
          id: string
          igdb_category: number | null
          igdb_id: number | null
          igdb_status: number | null
          search_vector: unknown
          slug: string | null
          storyline: string | null
          title: string
          title_search: unknown
        }
        Insert: {
          cover_img_url?: string | null
          date_released?: string | null
          game_description?: string | null
          id?: string
          igdb_category?: number | null
          igdb_id?: number | null
          igdb_status?: number | null
          search_vector?: unknown
          slug?: string | null
          storyline?: string | null
          title: string
          title_search?: unknown
        }
        Update: {
          cover_img_url?: string | null
          date_released?: string | null
          game_description?: string | null
          id?: string
          igdb_category?: number | null
          igdb_id?: number | null
          igdb_status?: number | null
          search_vector?: unknown
          slug?: string | null
          storyline?: string | null
          title?: string
          title_search?: unknown
        }
        Relationships: []
      }
      genres: {
        Row: {
          id: string
          igdb_id: number | null
          name: string
          slug: string | null
        }
        Insert: {
          id?: string
          igdb_id?: number | null
          name: string
          slug?: string | null
        }
        Update: {
          id?: string
          igdb_id?: number | null
          name?: string
          slug?: string | null
        }
        Relationships: []
      }
      group_invites: {
        Row: {
          created_at: string
          expires_at: string | null
          group_id: string
          id: string
          invited_by: string
          invited_profile_id: string
          status: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          group_id: string
          id?: string
          invited_by: string
          invited_profile_id: string
          status?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          group_id?: string
          id?: string
          invited_by?: string
          invited_profile_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_invited_profile_id_fkey"
            columns: ["invited_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_join_requests: {
        Row: {
          created_at: string
          group_id: string
          id: string
          message: string | null
          profile_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          message?: string | null
          profile_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          message?: string | null
          profile_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_join_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_join_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_join_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          custom_role_id: string | null
          group_id: string
          id: string
          joined_at: string
          profile_id: string
          role: string
        }
        Insert: {
          custom_role_id?: string | null
          group_id: string
          id?: string
          joined_at?: string
          profile_id: string
          role?: string
        }
        Update: {
          custom_role_id?: string | null
          group_id?: string
          id?: string
          joined_at?: string
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "group_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_roles: {
        Row: {
          can_edit_group: boolean
          can_invite: boolean
          can_manage_roles: boolean
          can_manage_sessions: boolean
          can_manage_watchlist: boolean
          can_remove_members: boolean
          color: string
          created_at: string
          group_id: string
          id: string
          is_view_only: boolean
          name: string
          role_rank: number
        }
        Insert: {
          can_edit_group?: boolean
          can_invite?: boolean
          can_manage_roles?: boolean
          can_manage_sessions?: boolean
          can_manage_watchlist?: boolean
          can_remove_members?: boolean
          color?: string
          created_at?: string
          group_id: string
          id?: string
          is_view_only?: boolean
          name: string
          role_rank?: number
        }
        Update: {
          can_edit_group?: boolean
          can_invite?: boolean
          can_manage_roles?: boolean
          can_manage_sessions?: boolean
          can_manage_watchlist?: boolean
          can_remove_members?: boolean
          color?: string
          created_at?: string
          group_id?: string
          id?: string
          is_view_only?: boolean
          name?: string
          role_rank?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_roles_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_session_members: {
        Row: {
          id: string
          profile_id: string
          session_id: string
        }
        Insert: {
          id?: string
          profile_id: string
          session_id: string
        }
        Update: {
          id?: string
          profile_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_session_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_session_members_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "group_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      group_sessions: {
        Row: {
          created_by: string
          game_id: string
          group_id: string
          id: string
          notes: string | null
          played_at: string
        }
        Insert: {
          created_by: string
          game_id: string
          group_id: string
          id?: string
          notes?: string | null
          played_at: string
        }
        Update: {
          created_by?: string
          game_id?: string
          group_id?: string
          id?: string
          notes?: string | null
          played_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_sessions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_sessions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_watchlist: {
        Row: {
          added_at: string
          added_by: string
          game_id: string
          group_id: string
          id: string
          notes: string | null
        }
        Insert: {
          added_at?: string
          added_by: string
          game_id: string
          group_id: string
          id?: string
          notes?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string
          game_id?: string
          group_id?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_watchlist_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_watchlist_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_watchlist_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          avatar_url: string | null
          banner_position: string
          banner_url: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          invite_code: string | null
          join_prompt: string | null
          name: string
          stats_config: Json | null
          visibility: string
        }
        Insert: {
          avatar_url?: string | null
          banner_position?: string
          banner_url?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          invite_code?: string | null
          join_prompt?: string | null
          name: string
          stats_config?: Json | null
          visibility?: string
        }
        Update: {
          avatar_url?: string | null
          banner_position?: string
          banner_url?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          invite_code?: string | null
          join_prompt?: string | null
          name?: string
          stats_config?: Json | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string | null
          id: string
          profile_id: string
          reaction_type: string
        }
        Insert: {
          comment_id: string
          created_at?: string | null
          id?: string
          profile_id: string
          reaction_type: string
        }
        Update: {
          comment_id?: string
          created_at?: string | null
          id?: string
          profile_id?: string
          reaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "list_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_comment_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_comment_votes: {
        Row: {
          comment_id: string
          created_at: string | null
          id: string
          profile_id: string
          vote: number
        }
        Insert: {
          comment_id: string
          created_at?: string | null
          id?: string
          profile_id: string
          vote: number
        }
        Update: {
          comment_id?: string
          created_at?: string | null
          id?: string
          profile_id?: string
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_comment_votes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "list_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_comment_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          list_id: string
          parent_id: string | null
          profile_id: string
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          list_id: string
          parent_id?: string | null
          profile_id: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          list_id?: string
          parent_id?: string | null
          profile_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "list_comments_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "list_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_entries: {
        Row: {
          added_at: string
          game_id: string
          id: string
          list_id: string
          notes: string | null
          position: number | null
        }
        Insert: {
          added_at?: string
          game_id: string
          id?: string
          list_id: string
          notes?: string | null
          position?: number | null
        }
        Update: {
          added_at?: string
          game_id?: string
          id?: string
          list_id?: string
          notes?: string | null
          position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "list_entries_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_entries_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_reactions: {
        Row: {
          id: string
          list_id: string
          profile_id: string
          reaction_type: string
        }
        Insert: {
          id?: string
          list_id: string
          profile_id: string
          reaction_type: string
        }
        Update: {
          id?: string
          list_id?: string
          profile_id?: string
          reaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_reactions_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_saves: {
        Row: {
          id: string
          is_hidden: boolean
          list_id: string
          profile_id: string
          saved_at: string
        }
        Insert: {
          id?: string
          is_hidden?: boolean
          list_id: string
          profile_id: string
          saved_at?: string
        }
        Update: {
          id?: string
          is_hidden?: boolean
          list_id?: string
          profile_id?: string
          saved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_saves_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_saves_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_votes: {
        Row: {
          id: string
          list_id: string
          profile_id: string
          vote: number
        }
        Insert: {
          id?: string
          list_id: string
          profile_id: string
          vote: number
        }
        Update: {
          id?: string
          list_id?: string
          profile_id?: string
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_votes_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          cover_image_url: string | null
          created_at: string
          default_view: string
          description: string | null
          id: string
          is_ranked: boolean
          profile_id: string
          shared_to_feed: boolean
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          default_view?: string
          description?: string | null
          id?: string
          is_ranked?: boolean
          profile_id: string
          shared_to_feed?: boolean
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          default_view?: string
          description?: string | null
          id?: string
          is_ranked?: boolean
          profile_id?: string
          shared_to_feed?: boolean
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "lists_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_profile_id: string | null
          comment_id: string | null
          created_at: string | null
          game_id: string | null
          group_id: string | null
          id: string
          list_id: string | null
          profile_id: string
          reaction_type: string | null
          read: boolean
          review_id: string | null
          type: string
        }
        Insert: {
          actor_profile_id?: string | null
          comment_id?: string | null
          created_at?: string | null
          game_id?: string | null
          group_id?: string | null
          id?: string
          list_id?: string | null
          profile_id: string
          reaction_type?: string | null
          read?: boolean
          review_id?: string | null
          type: string
        }
        Update: {
          actor_profile_id?: string | null
          comment_id?: string | null
          created_at?: string | null
          game_id?: string | null
          group_id?: string | null
          id?: string
          list_id?: string | null
          profile_id?: string
          reaction_type?: string | null
          read?: boolean
          review_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "review_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_reviews: {
        Row: {
          body: string | null
          created_at: string | null
          id: string
          platform_id: string | null
          profile_id: string | null
          score: number | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          id?: string
          platform_id?: string | null
          profile_id?: string | null
          score?: number | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          id?: string
          platform_id?: string | null
          profile_id?: string | null
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_reviews_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platforms: {
        Row: {
          banner_url: string | null
          display_group: string | null
          display_order: number | null
          id: string
          igdb_id: number | null
          logo_url: string | null
          name: string
          slug: string
        }
        Insert: {
          banner_url?: string | null
          display_group?: string | null
          display_order?: number | null
          id?: string
          igdb_id?: number | null
          logo_url?: string | null
          name: string
          slug: string
        }
        Update: {
          banner_url?: string | null
          display_group?: string | null
          display_order?: number | null
          id?: string
          igdb_id?: number | null
          logo_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auth_user_id: string
          avatar_url: string | null
          banner_position: string
          banner_url: string | null
          bio: string | null
          created_at: string
          dropped_privacy: string
          favorite_game_id: string | null
          id: string
          is_active: boolean
          is_group_admin: boolean
          library_hidden_tabs: string[]
          library_show_hours: boolean
          library_visibility: string
          showcase_games: Json | null
          steam_id: string | null
          steam_synced_at: string | null
          steam_username: string | null
          updated_at: string
          username: string
          want_to_play_privacy: string
        }
        Insert: {
          auth_user_id: string
          avatar_url?: string | null
          banner_position?: string
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          dropped_privacy?: string
          favorite_game_id?: string | null
          id?: string
          is_active?: boolean
          is_group_admin?: boolean
          library_hidden_tabs?: string[]
          library_show_hours?: boolean
          library_visibility?: string
          showcase_games?: Json | null
          steam_id?: string | null
          steam_synced_at?: string | null
          steam_username?: string | null
          updated_at?: string
          username: string
          want_to_play_privacy?: string
        }
        Update: {
          auth_user_id?: string
          avatar_url?: string | null
          banner_position?: string
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          dropped_privacy?: string
          favorite_game_id?: string | null
          id?: string
          is_active?: boolean
          is_group_admin?: boolean
          library_hidden_tabs?: string[]
          library_show_hours?: boolean
          library_visibility?: string
          showcase_games?: Json | null
          steam_id?: string | null
          steam_synced_at?: string | null
          steam_username?: string | null
          updated_at?: string
          username?: string
          want_to_play_privacy?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_favorite_game_id_fkey"
            columns: ["favorite_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_cache: {
        Row: {
          computed_at: string
          data: Json
          profile_id: string
        }
        Insert: {
          computed_at?: string
          data: Json
          profile_id: string
        }
        Update: {
          computed_at?: string
          data?: Json
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_cache_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          reason: string | null
          reporter_id: string
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          reason?: string | null
          reporter_id: string
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          reason?: string | null
          reporter_id?: string
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      review_comments: {
        Row: {
          body: string
          contains_spoilers: boolean
          created_at: string
          id: string
          is_hidden: boolean
          parent_id: string | null
          profile_id: string
          review_id: string
          updated_at: string | null
        }
        Insert: {
          body: string
          contains_spoilers?: boolean
          created_at?: string
          id?: string
          is_hidden?: boolean
          parent_id?: string | null
          profile_id: string
          review_id: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          contains_spoilers?: boolean
          created_at?: string
          id?: string
          is_hidden?: boolean
          parent_id?: string | null
          profile_id?: string
          review_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "review_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_comments_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_media: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          media_type: string
          review_id: string
          url: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          media_type: string
          review_id: string
          url?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          media_type?: string
          review_id?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_media_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_reactions: {
        Row: {
          created_at: string | null
          id: string
          profile_id: string
          reaction_type: string
          review_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          profile_id: string
          reaction_type: string
          review_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          profile_id?: string
          reaction_type?: string
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_reactions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_votes: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          review_id: string
          vote: number
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id?: string
          review_id?: string
          vote: number
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          review_id?: string
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "review_votes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string
          contains_spoilers: boolean
          created_at: string | null
          edited: boolean | null
          game_id: string
          id: string
          platform_played_on: string | null
          play_time_days: number | null
          play_time_hours: number | null
          play_time_months: number | null
          play_time_weeks: number | null
          play_time_years: number | null
          profile_id: string
          published_at: string | null
          score: number
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          body: string
          contains_spoilers: boolean
          created_at?: string | null
          edited?: boolean | null
          game_id: string
          id?: string
          platform_played_on?: string | null
          play_time_days?: number | null
          play_time_hours?: number | null
          play_time_months?: number | null
          play_time_weeks?: number | null
          play_time_years?: number | null
          profile_id?: string
          published_at?: string | null
          score: number
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          contains_spoilers?: boolean
          created_at?: string | null
          edited?: boolean | null
          game_id?: string
          id?: string
          platform_played_on?: string | null
          play_time_days?: number | null
          play_time_hours?: number | null
          play_time_months?: number | null
          play_time_weeks?: number | null
          play_time_years?: number | null
          profile_id?: string
          published_at?: string | null
          score?: number
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_platform_played_on_fkey"
            columns: ["platform_played_on"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_admins: {
        Row: {
          profile_id: string
        }
        Insert: {
          profile_id: string
        }
        Update: {
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_admins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      steam_unmatched_titles: {
        Row: {
          dismissed: boolean
          id: string
          last_seen_at: string
          occurrences: number
          title: string
          title_key: string
        }
        Insert: {
          dismissed?: boolean
          id?: string
          last_seen_at?: string
          occurrences?: number
          title: string
          title_key: string
        }
        Update: {
          dismissed?: boolean
          id?: string
          last_seen_at?: string
          occurrences?: number
          title?: string
          title_key?: string
        }
        Relationships: []
      }
      themes: {
        Row: {
          id: string
          igdb_id: number | null
          name: string
          slug: string | null
        }
        Insert: {
          id?: string
          igdb_id?: number | null
          name: string
          slug?: string | null
        }
        Update: {
          id?: string
          igdb_id?: number | null
          name?: string
          slug?: string | null
        }
        Relationships: []
      }
      user_game_status: {
        Row: {
          created_at: string
          game_id: string
          id: string
          is_hidden: boolean
          is_owned: boolean
          profile_id: string
          status: string
          steam_playtime_minutes: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          is_hidden?: boolean
          is_owned?: boolean
          profile_id: string
          status: string
          steam_playtime_minutes?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          is_hidden?: boolean
          is_owned?: boolean
          profile_id?: string
          status?: string
          steam_playtime_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_game_status_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_game_status_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist: {
        Row: {
          created_at: string | null
          game_id: string
          id: string
          profile_id: string
        }
        Insert: {
          created_at?: string | null
          game_id: string
          id?: string
          profile_id: string
        }
        Update: {
          created_at?: string | null
          game_id?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watchlist_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_profile_id: { Args: never; Returns: string }
      is_group_admin_or_owner: { Args: { gid: string }; Returns: boolean }
      is_group_member: { Args: { gid: string }; Returns: boolean }
      log_unmatched_steam_titles: {
        Args: { titles: string[] }
        Returns: undefined
      }
      match_steam_games: {
        Args: { steam_titles: string[] }
        Returns: {
          id: string
          title: string
        }[]
      }
      normalize_game_title: { Args: { input: string }; Returns: string }
      search_games: {
        Args: {
          genre_id?: string
          platform_id?: string
          result_limit?: number
          search_query: string
        }
        Returns: {
          cover_img_url: string
          date_released: string
          id: string
          sim: number
          slug: string
          title: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
