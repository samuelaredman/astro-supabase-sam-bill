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
      forum_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          parent_id: string | null
          post_id: string
          profile_id: string
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          post_id: string
          profile_id: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          post_id?: string
          profile_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forum_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "forum_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_post_reactions: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          profile_id: string
          reaction_type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          profile_id: string
          reaction_type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          profile_id?: string
          reaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_post_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_post_votes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          profile_id: string
          vote: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          profile_id: string
          vote: number
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          profile_id?: string
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "forum_post_votes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_post_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_posts: {
        Row: {
          body: string
          category: string
          created_at: string
          game_id: string | null
          id: string
          is_locked: boolean
          pinned: boolean
          profile_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          game_id?: string | null
          id?: string
          is_locked?: boolean
          pinned?: boolean
          profile_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          game_id?: string | null
          id?: string
          is_locked?: boolean
          pinned?: boolean
          profile_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forum_posts_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_profile_id_fkey"
            columns: ["profile_id"]
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
      game_relationships: {
        Row: {
          created_at: string
          from_game_id: string
          id: string
          relation_type: string
          source: string
          to_game_id: string
        }
        Insert: {
          created_at?: string
          from_game_id: string
          id?: string
          relation_type: string
          source?: string
          to_game_id: string
        }
        Update: {
          created_at?: string
          from_game_id?: string
          id?: string
          relation_type?: string
          source?: string
          to_game_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_relationships_from_game_id_fkey"
            columns: ["from_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_relationships_to_game_id_fkey"
            columns: ["to_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_revisions: {
        Row: {
          created_at: string
          game_id: string
          id: string
          igdb_ref: number | null
          kind: string
          label: string | null
          released_at: string | null
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          igdb_ref?: number | null
          kind: string
          label?: string | null
          released_at?: string | null
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          igdb_ref?: number | null
          kind?: string
          label?: string | null
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_revisions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_steam_apps: {
        Row: {
          created_at: string
          game_id: string
          steam_appid: number
        }
        Insert: {
          created_at?: string
          game_id: string
          steam_appid: number
        }
        Update: {
          created_at?: string
          game_id?: string
          steam_appid?: number
        }
        Relationships: [
          {
            foreignKeyName: "game_steam_apps_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
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
          canonical_game_id: string | null
          canonical_locked: boolean
          cover_img_url: string | null
          date_released: string | null
          game_description: string | null
          id: string
          igdb_category: number | null
          igdb_id: number | null
          igdb_parent_game: number | null
          igdb_status: number | null
          igdb_version_parent: number | null
          parent_game_id: string | null
          search_vector: unknown
          slug: string | null
          storyline: string | null
          title: string
          title_search: unknown
          version_title: string | null
        }
        Insert: {
          canonical_game_id?: string | null
          canonical_locked?: boolean
          cover_img_url?: string | null
          date_released?: string | null
          game_description?: string | null
          id?: string
          igdb_category?: number | null
          igdb_id?: number | null
          igdb_parent_game?: number | null
          igdb_status?: number | null
          igdb_version_parent?: number | null
          parent_game_id?: string | null
          search_vector?: unknown
          slug?: string | null
          storyline?: string | null
          title: string
          title_search?: unknown
          version_title?: string | null
        }
        Update: {
          canonical_game_id?: string | null
          canonical_locked?: boolean
          cover_img_url?: string | null
          date_released?: string | null
          game_description?: string | null
          id?: string
          igdb_category?: number | null
          igdb_id?: number | null
          igdb_parent_game?: number | null
          igdb_status?: number | null
          igdb_version_parent?: number | null
          parent_game_id?: string | null
          search_vector?: unknown
          slug?: string | null
          storyline?: string | null
          title?: string
          title_search?: unknown
          version_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "games_canonical_game_id_fkey"
            columns: ["canonical_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_parent_game_id_fkey"
            columns: ["parent_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
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
      group_announcements: {
        Row: {
          body: string
          created_at: string
          group_id: string
          id: string
          pinned: boolean
          profile_id: string
        }
        Insert: {
          body: string
          created_at?: string
          group_id: string
          id?: string
          pinned?: boolean
          profile_id: string
        }
        Update: {
          body?: string
          created_at?: string
          group_id?: string
          id?: string
          pinned?: boolean
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_announcements_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_announcements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_disagreement_votes: {
        Row: {
          created_at: string
          day: string
          game_id: string
          group_id: string
          id: string
          profile_id: string
          voted_for: string
        }
        Insert: {
          created_at?: string
          day: string
          game_id: string
          group_id: string
          id?: string
          profile_id: string
          voted_for: string
        }
        Update: {
          created_at?: string
          day?: string
          game_id?: string
          group_id?: string
          id?: string
          profile_id?: string
          voted_for?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_disagreement_votes_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_disagreement_votes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_disagreement_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_disagreement_votes_voted_for_fkey"
            columns: ["voted_for"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      group_poll_options: {
        Row: {
          id: string
          label: string
          poll_id: string
          position: number
        }
        Insert: {
          id?: string
          label: string
          poll_id: string
          position?: number
        }
        Update: {
          id?: string
          label?: string
          poll_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "group_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      group_poll_votes: {
        Row: {
          created_at: string
          id: string
          option_id: string
          poll_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          poll_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "group_poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "group_polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_poll_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_polls: {
        Row: {
          closed: boolean
          created_at: string
          group_id: string
          id: string
          profile_id: string
          question: string
        }
        Insert: {
          closed?: boolean
          created_at?: string
          group_id: string
          id?: string
          profile_id: string
          question: string
        }
        Update: {
          closed?: boolean
          created_at?: string
          group_id?: string
          id?: string
          profile_id?: string
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_polls_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_polls_profile_id_fkey"
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
          is_site_group: boolean
          join_prompt: string | null
          name: string
          requires_approval: boolean
          slug: string | null
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
          is_site_group?: boolean
          join_prompt?: string | null
          name: string
          requires_approval?: boolean
          slug?: string | null
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
          is_site_group?: boolean
          join_prompt?: string | null
          name?: string
          requires_approval?: boolean
          slug?: string | null
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
      import_job_items: {
        Row: {
          contains_spoilers: boolean
          created_at: string
          detail: string | null
          game_slug: string
          game_title: string
          hours_at_review: number | null
          id: string
          job_id: string
          matched_game_id: string | null
          platform_name: string | null
          play_status: string | null
          rating: number | null
          release_year: number | null
          review_date: string | null
          review_id: string | null
          review_text: string
          source_url: string | null
          status: string
          steam_appid: number | null
          updated_at: string | null
        }
        Insert: {
          contains_spoilers?: boolean
          created_at?: string
          detail?: string | null
          game_slug: string
          game_title: string
          hours_at_review?: number | null
          id?: string
          job_id: string
          matched_game_id?: string | null
          platform_name?: string | null
          play_status?: string | null
          rating?: number | null
          release_year?: number | null
          review_date?: string | null
          review_id?: string | null
          review_text: string
          source_url?: string | null
          status?: string
          steam_appid?: number | null
          updated_at?: string | null
        }
        Update: {
          contains_spoilers?: boolean
          created_at?: string
          detail?: string | null
          game_slug?: string | null
          game_title?: string
          hours_at_review?: number | null
          id?: string
          job_id?: string
          matched_game_id?: string | null
          platform_name?: string | null
          play_status?: string | null
          rating?: number | null
          release_year?: number | null
          review_date?: string | null
          review_id?: string | null
          review_text?: string
          source_url?: string | null
          status?: string
          steam_appid?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_job_items_matched_game_id_fkey"
            columns: ["matched_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_job_items_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "current_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_job_items_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          backloggd_username: string | null
          created_at: string
          draft_count: number
          error: string | null
          failed_count: number
          id: string
          imported_count: number
          needs_mapping_count: number
          processed_items: number
          profile_id: string
          scraped_pages: number
          skipped_count: number
          source: string
          status: string
          total_items: number
          total_pages: number | null
          updated_at: string | null
        }
        Insert: {
          backloggd_username?: string | null
          created_at?: string
          draft_count?: number
          error?: string | null
          failed_count?: number
          id?: string
          imported_count?: number
          needs_mapping_count?: number
          processed_items?: number
          profile_id: string
          scraped_pages?: number
          skipped_count?: number
          source?: string
          status?: string
          total_items?: number
          total_pages?: number | null
          updated_at?: string | null
        }
        Update: {
          backloggd_username?: string | null
          created_at?: string
          draft_count?: number
          error?: string | null
          failed_count?: number
          id?: string
          imported_count?: number
          needs_mapping_count?: number
          processed_items?: number
          profile_id?: string
          scraped_pages?: number
          skipped_count?: number
          source?: string
          status?: string
          total_items?: number
          total_pages?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_profile_id_fkey"
            columns: ["profile_id"]
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
          forum_post_id: string | null
          game_id: string | null
          group_id: string | null
          id: string
          list_id: string | null
          profile_id: string
          reaction_type: string | null
          read: boolean
          recommendation_id: string | null
          review_id: string | null
          type: string
        }
        Insert: {
          actor_profile_id?: string | null
          comment_id?: string | null
          created_at?: string | null
          forum_post_id?: string | null
          game_id?: string | null
          group_id?: string | null
          id?: string
          list_id?: string | null
          profile_id: string
          reaction_type?: string | null
          read?: boolean
          recommendation_id?: string | null
          review_id?: string | null
          type: string
        }
        Update: {
          actor_profile_id?: string | null
          comment_id?: string | null
          created_at?: string | null
          forum_post_id?: string | null
          game_id?: string | null
          group_id?: string | null
          id?: string
          list_id?: string | null
          profile_id?: string
          reaction_type?: string | null
          read?: boolean
          recommendation_id?: string | null
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
            foreignKeyName: "notifications_forum_post_id_fkey"
            columns: ["forum_post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
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
            foreignKeyName: "notifications_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "current_reviews"
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
          accent_color: string | null
          achievements_sync_cursor: number
          achievements_sync_snapshot: Json | null
          achievements_synced_at: string | null
          auth_user_id: string
          avatar_url: string | null
          backloggd_import_done_at: string | null
          backloggd_synced_at: string | null
          banner_position: string
          banner_url: string | null
          bio: string | null
          bluesky_url: string | null
          created_at: string
          discord_url: string | null
          dropped_privacy: string
          favorite_game_id: string | null
          featured_group_id: string | null
          id: string
          instagram_url: string | null
          is_active: boolean
          is_group_admin: boolean
          library_hidden_tabs: string[]
          library_show_hours: boolean
          library_visibility: string
          onboarding_completed_at: string | null
          psn_url: string | null
          retroachievements_url: string | null
          search_indexable: boolean
          search_indexable_at: string | null
          showcase_achievements: Json | null
          showcase_games: Json | null
          steam_id: string | null
          steam_reviews_import_done_at: string | null
          steam_synced_at: string | null
          steam_url: string | null
          steam_username: string | null
          tiktok_url: string | null
          twitch_url: string | null
          twitter_url: string | null
          updated_at: string
          username: string
          username_changed_at: string | null
          username_locked: boolean
          username_prev: string | null
          username_prev_until: string | null
          username_settling_count: number
          username_since: string
          want_to_play_privacy: string
          website_url: string | null
          xbox_url: string | null
          youtube_url: string | null
        }
        Insert: {
          accent_color?: string | null
          achievements_sync_cursor?: number
          achievements_sync_snapshot?: Json | null
          achievements_synced_at?: string | null
          auth_user_id: string
          avatar_url?: string | null
          backloggd_import_done_at?: string | null
          backloggd_synced_at?: string | null
          banner_position?: string
          banner_url?: string | null
          bio?: string | null
          bluesky_url?: string | null
          created_at?: string
          discord_url?: string | null
          dropped_privacy?: string
          favorite_game_id?: string | null
          featured_group_id?: string | null
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          is_group_admin?: boolean
          library_hidden_tabs?: string[]
          library_show_hours?: boolean
          library_visibility?: string
          onboarding_completed_at?: string | null
          psn_url?: string | null
          retroachievements_url?: string | null
          search_indexable?: boolean
          search_indexable_at?: string | null
          showcase_achievements?: Json | null
          showcase_games?: Json | null
          steam_id?: string | null
          steam_reviews_import_done_at?: string | null
          steam_synced_at?: string | null
          steam_url?: string | null
          steam_username?: string | null
          tiktok_url?: string | null
          twitch_url?: string | null
          twitter_url?: string | null
          updated_at?: string
          username: string
          username_changed_at?: string | null
          username_locked?: boolean
          username_prev?: string | null
          username_prev_until?: string | null
          username_settling_count?: number
          username_since?: string
          want_to_play_privacy?: string
          website_url?: string | null
          xbox_url?: string | null
          youtube_url?: string | null
        }
        Update: {
          accent_color?: string | null
          achievements_sync_cursor?: number
          achievements_sync_snapshot?: Json | null
          achievements_synced_at?: string | null
          auth_user_id?: string
          avatar_url?: string | null
          backloggd_import_done_at?: string | null
          backloggd_synced_at?: string | null
          banner_position?: string
          banner_url?: string | null
          bio?: string | null
          bluesky_url?: string | null
          created_at?: string
          discord_url?: string | null
          dropped_privacy?: string
          favorite_game_id?: string | null
          featured_group_id?: string | null
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          is_group_admin?: boolean
          library_hidden_tabs?: string[]
          library_show_hours?: boolean
          library_visibility?: string
          onboarding_completed_at?: string | null
          psn_url?: string | null
          retroachievements_url?: string | null
          search_indexable?: boolean
          search_indexable_at?: string | null
          showcase_achievements?: Json | null
          showcase_games?: Json | null
          steam_id?: string | null
          steam_reviews_import_done_at?: string | null
          steam_synced_at?: string | null
          steam_url?: string | null
          steam_username?: string | null
          tiktok_url?: string | null
          twitch_url?: string | null
          twitter_url?: string | null
          updated_at?: string
          username?: string
          username_changed_at?: string | null
          username_locked?: boolean
          username_prev?: string | null
          username_prev_until?: string | null
          username_settling_count?: number
          username_since?: string
          want_to_play_privacy?: string
          website_url?: string | null
          xbox_url?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_favorite_game_id_fkey"
            columns: ["favorite_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_featured_group_id_fkey"
            columns: ["featured_group_id"]
            isOneToOne: false
            referencedRelation: "groups"
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
      recommendation_comment_reactions: {
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
            foreignKeyName: "recommendation_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "recommendation_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_comment_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_comment_votes: {
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
            foreignKeyName: "recommendation_comment_votes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "recommendation_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_comment_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          parent_id: string | null
          profile_id: string
          recommendation_id: string
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          profile_id: string
          recommendation_id: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          profile_id?: string
          recommendation_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "recommendation_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_comments_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_reactions: {
        Row: {
          id: string
          profile_id: string
          reaction_type: string
          recommendation_id: string
        }
        Insert: {
          id?: string
          profile_id: string
          reaction_type: string
          recommendation_id: string
        }
        Update: {
          id?: string
          profile_id?: string
          reaction_type?: string
          recommendation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_reactions_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_votes: {
        Row: {
          id: string
          profile_id: string
          recommendation_id: string
          vote: number
        }
        Insert: {
          id?: string
          profile_id: string
          recommendation_id: string
          vote: number
        }
        Update: {
          id?: string
          profile_id?: string
          recommendation_id?: string
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_votes_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          body: string
          contains_spoilers: boolean
          created_at: string
          id: string
          profile_id: string
          source_game_id: string
          status: string
          target_game_id: string
        }
        Insert: {
          body: string
          contains_spoilers?: boolean
          created_at?: string
          id?: string
          profile_id: string
          source_game_id: string
          status?: string
          target_game_id: string
        }
        Update: {
          body?: string
          contains_spoilers?: boolean
          created_at?: string
          id?: string
          profile_id?: string
          source_game_id?: string
          status?: string
          target_game_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_source_game_id_fkey"
            columns: ["source_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_target_game_id_fkey"
            columns: ["target_game_id"]
            isOneToOne: false
            referencedRelation: "games"
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
            referencedRelation: "current_reviews"
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
            referencedRelation: "current_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_media_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_platforms: {
        Row: {
          platform_id: string
          review_id: string
        }
        Insert: {
          platform_id: string
          review_id: string
        }
        Update: {
          platform_id?: string
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_platforms_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_platforms_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "current_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_platforms_review_id_fkey"
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
            referencedRelation: "current_reviews"
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
            referencedRelation: "current_reviews"
            referencedColumns: ["id"]
          },
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
          revision_id: string | null
          score: number | null
          status: string | null
          title: string | null
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
          revision_id?: string | null
          score?: number | null
          status?: string | null
          title?: string | null
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
          revision_id?: string | null
          score?: number | null
          status?: string | null
          title?: string | null
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
          {
            foreignKeyName: "reviews_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "game_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews_repoint_backup_20260909: {
        Row: {
          id: string | null
          new_game_id: string | null
          old_game_id: string | null
        }
        Insert: {
          id?: string | null
          new_game_id?: string | null
          old_game_id?: string | null
        }
        Update: {
          id?: string | null
          new_game_id?: string | null
          old_game_id?: string | null
        }
        Relationships: []
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
      steam_app_schema: {
        Row: {
          achievements: Json
          fetched_at: string
          global_percents: Json
          steam_appid: number
        }
        Insert: {
          achievements?: Json
          fetched_at?: string
          global_percents?: Json
          steam_appid: number
        }
        Update: {
          achievements?: Json
          fetched_at?: string
          global_percents?: Json
          steam_appid?: number
        }
        Relationships: []
      }
      steam_import_dismissals: {
        Row: {
          dismissed_at: string
          dismissed_via: string
          profile_id: string
          steam_appid: number
        }
        Insert: {
          dismissed_at?: string
          dismissed_via: string
          profile_id: string
          steam_appid: number
        }
        Update: {
          dismissed_at?: string
          dismissed_via?: string
          profile_id?: string
          steam_appid?: number
        }
        Relationships: [
          {
            foreignKeyName: "steam_import_dismissals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
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
      user_achievements: {
        Row: {
          api_name: string
          description: string | null
          display_name: string | null
          game_id: string | null
          global_percent: number | null
          hidden: boolean
          icon_gray_url: string | null
          icon_url: string | null
          id: string
          profile_id: string
          steam_appid: number
          steam_game_title: string | null
          synced_at: string
          unlock_time: string | null
          unlocked: boolean
        }
        Insert: {
          api_name: string
          description?: string | null
          display_name?: string | null
          game_id?: string | null
          global_percent?: number | null
          hidden?: boolean
          icon_gray_url?: string | null
          icon_url?: string | null
          id?: string
          profile_id: string
          steam_appid: number
          steam_game_title?: string | null
          synced_at?: string
          unlock_time?: string | null
          unlocked?: boolean
        }
        Update: {
          api_name?: string
          description?: string | null
          display_name?: string | null
          game_id?: string | null
          global_percent?: number | null
          hidden?: boolean
          icon_gray_url?: string | null
          icon_url?: string | null
          id?: string
          profile_id?: string
          steam_appid?: number
          steam_game_title?: string | null
          synced_at?: string
          unlock_time?: string | null
          unlocked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          steam_appid: number | null
          steam_last_played_at: string | null
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
          steam_appid?: number | null
          steam_last_played_at?: string | null
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
          steam_appid?: number | null
          steam_last_played_at?: string | null
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
      username_history: {
        Row: {
          changed_at: string
          id: string
          old_username: string
          profile_id: string
          reclaimed_at: string | null
        }
        Insert: {
          changed_at?: string
          id?: string
          old_username: string
          profile_id: string
          reclaimed_at?: string | null
        }
        Update: {
          changed_at?: string
          id?: string
          old_username?: string
          profile_id?: string
          reclaimed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "username_history_profile_id_fkey"
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
      current_reviews: {
        Row: {
          body: string | null
          contains_spoilers: boolean | null
          created_at: string | null
          edited: boolean | null
          game_id: string | null
          id: string | null
          platform_played_on: string | null
          play_time_days: number | null
          play_time_hours: number | null
          play_time_months: number | null
          play_time_weeks: number | null
          play_time_years: number | null
          profile_id: string | null
          published_at: string | null
          revision_id: string | null
          score: number | null
          status: string | null
          title: string | null
          updated_at: string | null
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
          {
            foreignKeyName: "reviews_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "game_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      game_review_stats: {
        Row: {
          avg_score: number | null
          game_id: string | null
          hours_count: number | null
          hours_sum: number | null
          review_count: number | null
          score_sum: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_review_stats: {
        Row: {
          profile_id: string | null
          review_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      achievement_completion_by_appid: {
        Args: { p_profile_id: string }
        Returns: {
          pct: number
          steam_appid: number
        }[]
      }
      bulk_update_steam_playtime: {
        Args: { p_profile_id: string; p_updates: Json }
        Returns: undefined
      }
      game_rank_stats: {
        Args: { p_game_id: string; p_genre_id: string; p_release_year: number }
        Returns: {
          all_time_rank: number
          all_time_total: number
          genre_avg_score: number
          genre_rank: number
          genre_total: number
          year_rank: number
          year_total: number
        }[]
      }
      game_scores_by_slug: {
        Args: { p_slugs: string[] }
        Returns: {
          avg_score: number
          slug: string
        }[]
      }
      get_achievement_stats: {
        Args: { p_profile_id: string }
        Returns: {
          avg_completion: number
          perfect_games: number
          unlocked_count: number
        }[]
      }
      get_my_profile_id: { Args: never; Returns: string }
      group_compare_community_games: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
          p_prior_weight?: number
          p_profile_id: string
        }
        Returns: {
          community_avg: number
          community_count: number
          community_weighted: number
          cover_img_url: string
          diff: number
          diff_abs: number
          game_id: string
          slug: string
          subject_score: number
          title: string
        }[]
      }
      group_compare_community_summary: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_min_reviews?: number
          p_platform_id?: string
          p_profile_id: string
        }
        Returns: {
          above: number
          below: number
          community_avg: number
          level: number
          mean_abs_diff: number
          shared_games: number
          subject_avg: number
          within_one: number
        }[]
      }
      group_compare_games: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
          p_profile_ids: string[]
        }
        Returns: {
          cover_img_url: string
          game_id: string
          group_avg: number
          group_count: number
          sel_avg: number
          sel_count: number
          sel_spread: number
          sel_vs_group: number
          sel_vs_group_abs: number
          slug: string
          title: string
        }[]
      }
      group_compare_member_stats: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
          p_profile_ids: string[]
        }
        Returns: {
          avg_score: number
          hours_sum: number
          profile_id: string
          review_count: number
          vs_group_above: number
          vs_group_abs_diff: number
          vs_group_below: number
          vs_group_games: number
          vs_group_level: number
        }[]
      }
      group_compare_pairs: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
          p_profile_ids: string[]
        }
        Returns: {
          a_higher: number
          a_profile_id: string
          b_higher: number
          b_profile_id: string
          exact_matches: number
          mean_abs_diff: number
          shared_games: number
          within_one: number
        }[]
      }
      group_compare_scores: {
        Args: {
          p_game_ids: string[]
          p_group_id: string
          p_profile_ids: string[]
        }
        Returns: {
          game_id: string
          profile_id: string
          score: number
        }[]
      }
      group_consensus_picks: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_limit?: number
          p_min_reviews?: number
          p_platform_id?: string
        }
        Returns: {
          avg_score: number
          cover_img_url: string
          game_id: string
          max_score: number
          min_score: number
          review_count: number
          score_variance: number
          slug: string
          title: string
        }[]
      }
      group_daily_disagreement: {
        Args: {
          p_day: string
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
        }
        Returns: {
          game_id: string
          high_profile_id: string
          high_review_id: string
          high_score: number
          low_profile_id: string
          low_review_id: string
          low_score: number
          spread: number
        }[]
      }
      group_disagreement_tally: {
        Args: { p_day: string; p_group_id: string }
        Returns: {
          voted_for: string
          votes: number
        }[]
      }
      group_divergent_picks: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_limit?: number
          p_min_reviews?: number
          p_platform_id?: string
        }
        Returns: {
          avg_score: number
          cover_img_url: string
          game_id: string
          max_score: number
          min_score: number
          review_count: number
          score_variance: number
          slug: string
          title: string
        }[]
      }
      group_feed: {
        Args: {
          p_filter?: string
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
          p_viewer_profile_id?: string
        }
        Returns: {
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
          revision_id: string | null
          score: number | null
          status: string | null
          title: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      group_game_member_scores: {
        Args: { p_game_ids: string[]; p_group_id: string }
        Returns: {
          game_id: string
          profile_id: string
          score: number
        }[]
      }
      group_game_review_stats: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
        }
        Returns: {
          avg_score: number
          cover_img_url: string
          game_id: string
          max_score: number
          min_score: number
          review_count: number
          slug: string
          title: string
        }[]
      }
      group_hidden_gems: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_limit?: number
          p_max_community_reviews?: number
          p_min_group_avg?: number
          p_min_group_reviews?: number
          p_platform_id?: string
        }
        Returns: {
          community_count: number
          cover_img_url: string
          game_id: string
          group_avg: number
          group_count: number
          slug: string
          title: string
        }[]
      }
      group_hot_take: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
        }
        Returns: {
          community_avg: number
          community_count: number
          game_id: string
          group_avg: number
          group_count: number
        }[]
      }
      group_member_review_stats: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
        }
        Returns: {
          avg_score: number
          profile_id: string
          review_count: number
        }[]
      }
      group_review_summary: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
        }
        Returns: {
          avg_score: number
          game_count: number
          hours_sum: number
          review_count: number
        }[]
      }
      group_reviews: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
        }
        Returns: {
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
          revision_id: string | null
          score: number | null
          status: string | null
          title: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      group_score_distribution: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
          p_profile_ids?: string[]
        }
        Returns: {
          profile_id: string
          review_count: number
          score: number
        }[]
      }
      group_split_decision: {
        Args: {
          p_genre_id?: string
          p_group_id: string
          p_platform_id?: string
        }
        Returns: {
          game_id: string
          high_profile_id: string
          high_score: number
          low_profile_id: string
          low_score: number
          spread: number
        }[]
      }
      hub_game_review_stats: {
        Args: {
          p_company_id?: string
          p_genre_id?: string
          p_platform_id?: string
        }
        Returns: {
          game_id: string
          review_count: number
          score_sum: number
        }[]
      }
      is_group_admin_or_owner: { Args: { gid: string }; Returns: boolean }
      is_group_member: { Args: { gid: string }; Returns: boolean }
      library_status_counts: {
        Args: { p_profile_id: string }
        Returns: {
          all_count: number
          completed: number
          dropped: number
          hidden: number
          hundred_percent: number
          owned: number
          playing: number
          unplayed: number
          want_to_play: number
        }[]
      }
      log_unmatched_steam_titles: {
        Args: { titles: string[] }
        Returns: undefined
      }
      match_steam_games: {
        Args: { steam_titles: string[] }
        Returns: {
          id: string
          steam_title: string
          title: string
        }[]
      }
      most_reviewed_games: {
        Args: {
          p_exclude_profile_id?: string
          p_genre_id?: string
          p_limit?: number
          p_platform_id?: string
        }
        Returns: {
          avg_score: number
          game_id: string
          review_count: number
        }[]
      }
      normalize_game_title: { Args: { input: string }; Returns: string }
      profile_game_community_stats: {
        Args: { p_profile_id: string }
        Returns: {
          avg_score: number
          game_id: string
          hours_count: number
          hours_sum: number
          review_count: number
        }[]
      }
      profile_vote_totals: {
        Args: { p_profile_id: string }
        Returns: {
          downvotes: number
          upvotes: number
        }[]
      }
      ranked_games: {
        Args: {
          p_limit?: number
          p_min_reviews?: number
          p_prior_weight?: number
        }
        Returns: {
          avg_score: number
          bayesian_score: number
          game_id: string
          review_count: number
        }[]
      }
      review_score_summary: {
        Args: never
        Returns: {
          avg_score: number
          review_count: number
        }[]
      }
      reviewer_volume_percentile: {
        Args: { p_profile_id: string }
        Returns: number
      }
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
      steam_appid_last_synced: {
        Args: { p_profile_id: string }
        Returns: {
          last_synced_at: string
          steam_appid: number
        }[]
      }
      top_studios_by_reviewed_games: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          name: string
          reviewed_game_count: number
          slug: string
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      user_synced_steam_appids: {
        Args: { p_profile_id: string }
        Returns: {
          steam_appid: number
        }[]
      }
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
