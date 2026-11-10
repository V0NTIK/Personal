-- Quadra Chess / Supabase PostgreSQL schema
-- Apply to a NEW, dedicated Supabase project before importing Render data.
-- This schema preserves the original Quadra account/session system and the game's
-- PostgreSQL wire protocol. It does NOT provision Supabase Auth or browser-side keys.
-- Application tables use public for compatibility with existing SQL.
-- RLS and revoked API roles prevent Supabase Data API access.
-- Import original data BEFORE the Node.js API first boots on the new database.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quadra_rooms (
  id varchar(7) PRIMARY KEY,
  revision integer NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS quadra_rooms_expires_idx
  ON public.quadra_rooms (expires_at);

CREATE TABLE IF NOT EXISTS public.quadra_accounts (
  id uuid PRIMARY KEY,
  handle varchar(20) NOT NULL UNIQUE,
  pass_salt varchar(64) NOT NULL,
  pass_hash varchar(128) NOT NULL,
  recovery_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  role varchar(20) NOT NULL DEFAULT 'user',
  banned_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.quadra_sessions (
  token_hash varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.quadra_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS quadra_sessions_user_idx
  ON public.quadra_sessions (user_id);
CREATE INDEX IF NOT EXISTS quadra_sessions_expiry_idx
  ON public.quadra_sessions (expires_at);

-- Exactly-once superuser bootstrap marker, if present in the original database,
-- MUST migrate with the accounts table. Do not recreate or edit this marker manually.
CREATE TABLE IF NOT EXISTS public.quadra_admin_bootstrap (
  name varchar(32) PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS public.quadra_player_stats (
  user_id uuid NOT NULL REFERENCES public.quadra_accounts(id) ON DELETE CASCADE,
  mode varchar(10) NOT NULL,
  rating integer NOT NULL DEFAULT 1200,
  games integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  draws integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mode)
);

CREATE TABLE IF NOT EXISTS public.quadra_rated_results (
  room_id varchar(7) NOT NULL,
  game_no integer NOT NULL,
  players_key varchar(160) NOT NULL,
  mode varchar(10) NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  status varchar(24) NOT NULL,
  PRIMARY KEY (room_id, game_no)
);
CREATE INDEX IF NOT EXISTS quadra_rated_results_repeat_idx
  ON public.quadra_rated_results (players_key, calculated_at);

-- Supabase public schema is Data API-exposed by default. No direct browser
-- access to passwords, session hashes, room data or rankings is authorized.
-- The existing Node.js server continues to enforce all access permissions.
ALTER TABLE public.quadra_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quadra_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quadra_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quadra_admin_bootstrap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quadra_player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quadra_rated_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.quadra_rooms,
  public.quadra_accounts,
  public.quadra_sessions,
  public.quadra_admin_bootstrap,
  public.quadra_player_stats,
  public.quadra_rated_results
FROM PUBLIC, anon, authenticated;

-- Explicitly do not add public read policies. Server uses privileged
-- PostgreSQL credentials stored only in Render's server-side environment.
COMMIT;
