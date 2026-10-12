-- Onthousels schema. Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Every row belongs to the signed-in user; Row Level Security keeps each person's notes private.

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default '',
  content     jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  mode        text not null default 'text' check (mode in ('text', 'checklist')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.labels (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 50),
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.note_labels (
  note_id   uuid not null references public.notes (id) on delete cascade,
  label_id  uuid not null references public.labels (id) on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (note_id, label_id)
);

create index if not exists notes_user_created_idx on public.notes (user_id, created_at desc);
create index if not exists note_labels_label_idx on public.note_labels (label_id);
create index if not exists note_labels_user_idx  on public.note_labels (user_id);

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

-- Row Level Security
alter table public.notes       enable row level security;
alter table public.labels      enable row level security;
alter table public.note_labels enable row level security;

-- The app only talks to the database once signed in, so signed-out visitors get no access at all.
revoke all on public.notes, public.labels, public.note_labels from anon;

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own labels" on public.labels;
create policy "own labels" on public.labels
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A link may only join a note and a label that both belong to the same user.
drop policy if exists "own note_labels" on public.note_labels;
create policy "own note_labels" on public.note_labels
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.notes  n where n.id = note_id  and n.user_id = (select auth.uid()))
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = (select auth.uid()))
  );
