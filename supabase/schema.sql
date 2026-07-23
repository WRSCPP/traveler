-- ============================================================================
-- Traveler — Supabase schema
-- Run this once in Supabase → SQL Editor → New query → Run.
--
-- Design: each store is one table with a text primary key and a JSONB `doc`
-- column holding the record exactly as the app already shapes it. That keeps
-- the app code identical to the local version while giving us a real database,
-- live updates and per-user permissions.
-- ============================================================================

create table if not exists builds   (id text primary key, doc jsonb not null, updated_at timestamptz default now());
create table if not exists lines    (id text primary key, doc jsonb not null, updated_at timestamptz default now());
create table if not exists stages   (id text primary key, doc jsonb not null, updated_at timestamptz default now());
create table if not exists settings (id text primary key, doc jsonb not null, updated_at timestamptz default now());
create table if not exists audit    (id text primary key, doc jsonb not null, updated_at timestamptz default now());

-- Who is allowed to edit. Add a row here for each of your 2–5 editors after
-- creating their user in Supabase → Authentication → Users.
create table if not exists editors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email   text,
  added_at timestamptz default now()
);

create or replace function is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from editors where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: anyone may READ (that's the 25+ viewers), only listed
-- editors may WRITE. This is what makes publishing the anon key safe.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['builds','lines','stages','settings','audit'] loop
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists "read all" on %I', t);
    execute format('create policy "read all" on %I for select using (true)', t);

    execute format('drop policy if exists "editors insert" on %I', t);
    execute format('create policy "editors insert" on %I for insert with check (is_editor())', t);

    execute format('drop policy if exists "editors update" on %I', t);
    execute format('create policy "editors update" on %I for update using (is_editor()) with check (is_editor())', t);

    execute format('drop policy if exists "editors delete" on %I', t);
    execute format('create policy "editors delete" on %I for delete using (is_editor())', t);
  end loop;
end $$;

alter table editors enable row level security;
drop policy if exists "read editors" on editors;
create policy "read editors" on editors for select using (true);

-- ---------------------------------------------------------------------------
-- Live updates: publish these tables to the realtime stream so every open
-- browser sees changes as they happen.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['builds','lines','stages','settings','audit'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- File storage for attachments and inspection photos.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('traveler-files', 'traveler-files', true)
on conflict (id) do nothing;

drop policy if exists "files readable" on storage.objects;
create policy "files readable" on storage.objects
  for select using (bucket_id = 'traveler-files');

drop policy if exists "editors upload files" on storage.objects;
create policy "editors upload files" on storage.objects
  for insert with check (bucket_id = 'traveler-files' and is_editor());

drop policy if exists "editors delete files" on storage.objects;
create policy "editors delete files" on storage.objects
  for delete using (bucket_id = 'traveler-files' and is_editor());

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS:
--   1. Authentication → Users → Add user, for each editor (email + password).
--   2. Copy each new user's UUID and run, once per editor:
--        insert into editors (user_id, email) values ('<uuid>', '<email>');
--   3. Settings → API → copy the Project URL and the anon public key into
--      src/config.js, and set MODE to 'cloud'.
-- ---------------------------------------------------------------------------
