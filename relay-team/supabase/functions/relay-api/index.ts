import { createHandler, RestStore } from './core.mjs';
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const key = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!key) throw new Error('Supabase server key unavailable');
Deno.serve(createHandler(new RestStore(Deno.env.get('SUPABASE_URL'), key)));
