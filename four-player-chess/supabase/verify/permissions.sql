-- Supabase target only. Every row should read:
-- rls_enabled=true, anon_can_select=false, authenticated_can_select=false.
-- Do not GRANT application tables to the Data API roles.
WITH tables AS (
 SELECT unnest(ARRAY[
  'quadra_rooms','quadra_accounts','quadra_sessions',
  'quadra_admin_bootstrap','quadra_player_stats','quadra_rated_results'
 ]) AS table_name
)
SELECT t.table_name, c.relrowsecurity AS rls_enabled,
 has_table_privilege('anon','public.'||t.table_name,'SELECT') AS anon_can_select,
 has_table_privilege('authenticated','public.'||t.table_name,'SELECT') AS authenticated_can_select
FROM tables t
JOIN pg_class c ON c.relname=t.table_name
JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
ORDER BY t.table_name;

-- Sanity-check the app's foreign key constraints were installed.
SELECT tc.table_name,tc.constraint_name,kcu.column_name,
 ccu.table_name AS referenced_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
 ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
 ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
WHERE tc.table_schema='public'
 AND tc.constraint_type='FOREIGN KEY'
 AND tc.table_name IN('quadra_sessions','quadra_player_stats')
ORDER BY tc.table_name,tc.constraint_name;
