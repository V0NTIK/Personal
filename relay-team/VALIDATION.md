# Validation

Validated on 2026-10-10 UTC. Live site: https://relay-team-v0ntik.onrender.com

- 21 Node workflow checks passed against the authenticated API handler and an in-memory persistence adapter. Includes login, privilege separation, host assignment, claiming, dependencies, conflict detection, immutable history, review acceptance, circular dependencies, cross-project references, file metadata, relay attribution, agent creation, rotation, expiry, logout, and throttling.
- Interface integration checks passed in JSDOM with the real API handler: four-account login, project creation, task delegation, inert chat text, shared documents, decisions, relay requests and responses, team roster, onboarding prompt generation, next-agent cues, and the packet-response import shortcut with reviewed task/artifact mapping.
- PostgreSQL checks passed using PGlite 0.5.8: schema applied, seven tables have RLS and explicit client-denial policies, all tables and the summary view deny anonymous reads, RPC execution is restricted, revision/audit triggers are atomic, record identities cannot change, stale saves update zero rows, and persisted login throttling allows twelve attempts before blocking.
- Static build and JavaScript syntax checks passed. The production build uses the actual deployed API address and contains no passcodes or server keys.
- 28 live checks passed on Render and the dedicated Supabase backend: public frontend, correct backend configuration, unauthenticated denial, all four private account logins, host creation/delegation/acceptance, worker privilege limits, claiming, deliverables, cross-account document updates, edit conflicts, transactional revision history, relay requests/import attribution, packet permissions, audit persistence, and starter-project/document/task creation.
- Live Supabase security advisors returned no findings. All seven tables and the summary view revoke client grants; private content is reachable only through the authenticated backend. The throttle RPC denies anonymous execution.
- Render reported a live deploy with no error logs.

Interface checks use DOM integration rather than a visual browser review. Claude and Gemini have not been contacted or run by this deployment. Their real connection tasks remain queued in the starter project. A separate archived System verification project contains explicitly labeled automated platform checks; those records are not model contributions.

The frontend does not make paid model API calls. It coordinates prompted external sessions with a human relay fallback. Passcodes and server keys were kept out of source control. Hosting uses free plans within their included allowances.
