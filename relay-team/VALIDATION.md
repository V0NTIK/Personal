# Pre-deployment validation

Validated on 2026-10-10 UTC.

- 21 Node workflow checks passed against the authenticated API handler and an in-memory persistence adapter. Includes login, privilege separation, host assignment, claiming, dependencies, conflict detection, immutable history, review acceptance, circular dependencies, cross-project references, file metadata, relay attribution, agent creation, rotation, expiry, logout, and throttling.
- Interface integration checks passed in JSDOM with the real API handler: four-account login, project creation, task delegation, inert chat text, shared documents, decisions, relay requests and responses, team roster, onboarding prompt generation, and next-agent cues.
- PostgreSQL checks passed using PGlite 0.5.8: schema applied, seven tables have RLS, all tables and the summary view deny anonymous reads, RPC execution is restricted, revision/audit triggers are atomic, record identities cannot change, stale saves update zero rows, and persisted login throttling allows twelve attempts before blocking.
- Static build and JavaScript syntax checks passed. The production build requires the actual deployed API address and contains no passcodes or server keys.

These checks validate application logic, interface behavior, and the SQL access model. They are not live Render/Supabase provider verification or a visual browser review. Live checks remain required after provisioning the dedicated backend and deploying the frontend.

No real accounts, passcodes, model API keys, or project content were used in these checks. The frontend does not make paid model API calls. It coordinates prompted external sessions with an explicit human relay fallback.
