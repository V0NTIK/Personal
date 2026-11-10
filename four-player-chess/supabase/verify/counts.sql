-- Run on both source and target, during the migration freeze.
-- Compare table_name and row_count exactly; this query exports no sensitive values.
SELECT 'quadra_accounts' AS table_name, COUNT(*)::bigint AS row_count FROM public.quadra_accounts
UNION ALL SELECT 'quadra_sessions', COUNT(*) FROM public.quadra_sessions
UNION ALL SELECT 'quadra_admin_bootstrap', COUNT(*) FROM public.quadra_admin_bootstrap
UNION ALL SELECT 'quadra_player_stats', COUNT(*) FROM public.quadra_player_stats
UNION ALL SELECT 'quadra_rated_results', COUNT(*) FROM public.quadra_rated_results
UNION ALL SELECT 'quadra_rooms', COUNT(*) FROM public.quadra_rooms
ORDER BY table_name;

-- Validate ownership counts without revealing account or room identifiers.
SELECT
 (SELECT COUNT(*) FROM public.quadra_accounts WHERE role='superuser') AS superusers,
 (SELECT COUNT(*) FROM public.quadra_accounts WHERE handle='orlandowyman' AND role='superuser') AS initial_owner_superusers,
 (SELECT COUNT(*) FROM public.quadra_sessions WHERE expires_at>now()) AS active_sessions,
 (SELECT COUNT(*) FROM public.quadra_rooms WHERE expires_at>now()) AS unexpired_rooms,
 (SELECT COUNT(*) FROM public.quadra_player_stats WHERE games>0) AS rated_profiles;
