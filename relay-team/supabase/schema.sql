-- Relay Team: deny-by-default tables. Only the authenticated Edge backend uses them.
create table public.relay_accounts (
 id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,39}$'),
 name text not null, model text not null default '', role text not null check(role in ('owner','host','collaborator')),
 pass_hash text not null, pass_salt text not null, active boolean not null default true,
 capability text not null default 'relay' check(capability in ('relay','browser','api')),
 last_seen timestamptz, created_at timestamptz not null default now()
);
create table public.relay_sessions (
 token_hash text primary key, account_id text not null references public.relay_accounts(id),
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index relay_sessions_account_idx on public.relay_sessions(account_id);
create index relay_sessions_expiry_idx on public.relay_sessions(expires_at);
create table public.relay_attempts (
 id bigint generated always as identity primary key, bucket text not null,
 created_at timestamptz not null default now()
);
create index relay_attempts_bucket_idx on public.relay_attempts(bucket,created_at);
-- Atomic rate limit. Not executable by clients, including authenticated Supabase users.
create function public.relay_throttle(p_bucket text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_bucket,0));
 select count(*) into n from public.relay_attempts where bucket=p_bucket and created_at>now()-interval '15 minutes';
 if n>=12 then return false; end if;
 insert into public.relay_attempts(bucket) values(p_bucket);
 delete from public.relay_attempts where created_at<now()-interval '1 day';
 return true;
end; $$;
revoke all on function public.relay_throttle(text) from public,anon,authenticated;
grant execute on function public.relay_throttle(text) to service_role;
create table public.relay_records (
 id uuid primary key default gen_random_uuid(),
 project_id uuid references public.relay_records(id),
 kind text not null check(kind in ('project','task','message','document','artifact','relay','decision')),
 data jsonb not null default '{}'::jsonb,
 created_by text not null references public.relay_accounts(id),
 modified_by text not null references public.relay_accounts(id),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((kind='project' and project_id is null) or (kind<>'project' and project_id is not null))
);
create index relay_records_project_idx on public.relay_records(project_id,kind,created_at);
create index relay_records_kind_idx on public.relay_records(kind,updated_at);
create table public.relay_revisions (
 id bigint generated always as identity primary key,
 record_id uuid not null references public.relay_records(id), version integer not null,
 data jsonb not null, author text not null references public.relay_accounts(id),
 created_at timestamptz not null default now(), unique(record_id,version)
);
create index relay_revisions_record_idx on public.relay_revisions(record_id,version);
create table public.relay_audit (
 id bigint generated always as identity primary key, project_id uuid,
 record_id uuid not null, actor text not null, action text not null,
 kind text not null, version integer not null, title text not null, created_at timestamptz not null default now()
);
create index relay_audit_project_idx on public.relay_audit(project_id,created_at);
create table public.relay_reads (
 account_id text not null references public.relay_accounts(id),
 project_id uuid not null references public.relay_records(id),
 last_read timestamptz not null default now(), primary key(account_id,project_id)
);
-- AFTER trigger retains version set by the BEFORE trigger, and logs atomically.
create function public.relay_record_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if new.kind<>old.kind or new.project_id is distinct from old.project_id or new.created_by<>old.created_by then raise exception 'Record identity cannot change'; end if;
 new.version:=old.version+1; new.updated_at:=now(); return new;
end; $$;
-- History no longer mutates the version; before trigger owns that operation.
create function public.relay_record_history() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 insert into public.relay_revisions(record_id,version,data,author) values(new.id,new.version,new.data,new.modified_by);
 insert into public.relay_audit(project_id,record_id,actor,action,kind,version,title)
 values(coalesce(new.project_id,new.id),new.id,new.modified_by,lower(TG_OP),new.kind,new.version,left(coalesce(new.data->>'title',new.data->>'body',''),160));
 return new;
end; $$;
create trigger relay_version before update on public.relay_records for each row execute function public.relay_record_version();
create trigger relay_history after insert or update on public.relay_records for each row execute function public.relay_record_history();
revoke all on function public.relay_record_history() from public,anon,authenticated;
revoke all on function public.relay_record_version() from public,anon,authenticated;
DO $$ declare t text; begin
 foreach t in array ARRAY['relay_accounts','relay_sessions','relay_attempts','relay_records','relay_revisions','relay_audit','relay_reads'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.relay_attempts_id_seq,public.relay_revisions_id_seq,public.relay_audit_id_seq to service_role;
-- Avoid fetching uploaded binary content in dashboards. Direct client grants remain revoked.
create view public.relay_record_summaries with(security_invoker=true) as
select id,project_id,kind,data-'file_base64' as data,created_by,modified_by,version,created_at,updated_at from public.relay_records;
revoke all on public.relay_record_summaries from anon,authenticated;
grant select on public.relay_record_summaries to service_role;
