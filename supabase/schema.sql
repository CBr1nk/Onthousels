-- Onthousels schema. Run in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It's safe to run again: on an existing project it adds whatever is missing.
-- Every row belongs to the signed-in user; Row Level Security keeps each person's notes private,
-- apart from notes they've chosen to share with a friend.

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
  created_at  timestamptz not null default now()
);

create table if not exists public.note_labels (
  note_id   uuid not null references public.notes (id) on delete cascade,
  label_id  uuid not null references public.labels (id) on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (note_id, label_id)
);

-- Personal and Work keep separate notes, labels and to-do lists.
alter table public.notes  add column if not exists space text not null default 'personal' check (space in ('personal', 'work'));
alter table public.labels add column if not exists space text not null default 'personal' check (space in ('personal', 'work'));
-- Label names are unique within a space (earlier versions made them unique per person).
alter table public.labels drop constraint if exists labels_user_id_name_key;
create unique index if not exists labels_user_space_name_idx on public.labels (user_id, space, name);

-- A friend request is sent to an email address, so it can wait for someone who hasn't signed in yet.
-- Each side names the other however they like.
create table if not exists public.friendships (
  id               uuid primary key default gen_random_uuid(),
  requester_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  requester_email  text not null,
  addressee_email  text not null check (addressee_email = lower(btrim(addressee_email)) and addressee_email like '_%@_%'),
  -- Filled in once the request is accepted.
  addressee_id     uuid references auth.users (id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  -- What the requester calls the addressee, and the other way round.
  requester_alias  text not null default '' check (char_length(requester_alias) <= 60),
  addressee_alias  text not null default '' check (char_length(addressee_alias) <= 60),
  created_at       timestamptz not null default now(),
  unique (requester_id, addressee_email)
);

-- A note shared with a friend. `space` is where it sits on the friend's desk.
create table if not exists public.note_shares (
  note_id     uuid not null references public.notes (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  space       text not null default 'personal' check (space in ('personal', 'work')),
  created_at  timestamptz not null default now(),
  primary key (note_id, user_id)
);

-- A note can hold pages: child notes (one level deep) that belong to it and go wherever it's shared.
-- `position` orders a note's pages, and this person's own pinned tabs; note_shares.position orders a
-- friend's tabs on their side.
alter table public.notes       add column if not exists parent_id uuid references public.notes (id) on delete cascade;
alter table public.notes       add column if not exists position double precision not null default 0;
alter table public.note_shares add column if not exists position double precision not null default 0;

create index if not exists notes_user_created_idx      on public.notes (user_id, created_at desc);
create index if not exists notes_parent_idx            on public.notes (parent_id);
create index if not exists note_labels_label_idx       on public.note_labels (label_id);
create index if not exists note_labels_user_idx        on public.note_labels (user_id);
create index if not exists note_shares_user_idx        on public.note_shares (user_id);
create index if not exists friendships_addressee_idx   on public.friendships (addressee_id);
create index if not exists friendships_email_idx       on public.friendships (addressee_email);

-- ───────────────────────── Helpers ─────────────────────────
-- Kept out of the API's reach. The security definer ones read note_shares/notes without RLS,
-- which is what stops the notes and note_shares policies from looking each other up forever.

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.shared_note_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select note_id from public.note_shares where user_id = (select auth.uid());
$$;

create or replace function private.owns_note(nid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.notes where id = nid and user_id = (select auth.uid()));
$$;

-- Live editing happens on a channel named "note:<id>", open to the note's owner and the friends it's shared with.
create or replace function private.can_join_note(topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when topic ~ '^note:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then exists (
      select 1 from public.notes n
      where n.id = substr(topic, 6)::uuid
        and (n.user_id = (select auth.uid())
             or exists (select 1 from public.note_shares s
                        where s.note_id in (n.id, n.parent_id) and s.user_id = (select auth.uid())))
    )
    else false
  end;
$$;

create or replace function private.my_email()
returns text language sql stable set search_path = '' as $$
  select lower(auth.jwt() ->> 'email');
$$;

revoke all on function private.shared_note_ids(), private.owns_note(uuid), private.can_join_note(text), private.my_email() from public, anon;
grant execute on function private.shared_note_ids(), private.owns_note(uuid), private.can_join_note(text), private.my_email() to authenticated;

-- ───────────────────────── Triggers ─────────────────────────

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

-- A note never changes hands or parents, and a friend editing it can't move it between the owner's
-- spaces or rearrange the owner's tabs. (A note's pages are everyone's to arrange.) With nobody
-- signed in, as in the SQL editor, anything goes.
create or replace function private.guard_note()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.parent_id := old.parent_id;
  new.created_at := old.created_at;
  if (select auth.uid()) is not null and old.user_id <> (select auth.uid()) then
    new.space := old.space;
    new.pinned := old.pinned;
    if old.parent_id is null then
      new.position := old.position;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notes_guard on public.notes;
create trigger notes_guard
  before update on public.notes
  for each row execute function private.guard_note();

-- A page belongs to its note's owner and sits in the same space, whoever adds it, so it goes
-- wherever the note is shared. Pages don't hold pages of their own.
create or replace function private.place_page()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select user_id, space, parent_id into parent from public.notes where id = new.parent_id;
  if not found then
    raise exception 'That note isn''t there.';
  end if;
  if parent.parent_id is not null then
    raise exception 'A page can''t hold pages of its own.';
  end if;
  new.user_id := parent.user_id;
  new.space := parent.space;
  new.pinned := false;
  return new;
end;
$$;

drop trigger if exists notes_place_page on public.notes;
create trigger notes_place_page
  before insert on public.notes
  for each row execute function private.place_page();

-- Only the friend a share belongs to can arrange it (its position among their tabs).
create or replace function private.guard_share()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.note_id := old.note_id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists note_shares_guard on public.note_shares;
create trigger note_shares_guard
  before update on public.note_shares
  for each row execute function private.guard_share();

-- The requester is always whoever is signed in. Afterwards each side may only change their own part:
-- the requester their name for the friend, the addressee the answer and their name for the requester.
create or replace function private.guard_friendship()
returns trigger language plpgsql set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.requester_id := me;
    new.requester_email := private.my_email();
    new.addressee_email := lower(btrim(new.addressee_email));
    new.addressee_id := null;
    new.status := 'pending';
    new.addressee_alias := '';
    if new.addressee_email = new.requester_email then
      raise exception 'You can''t add yourself as a friend.';
    end if;
    return new;
  end if;

  new.id := old.id;
  new.requester_id := old.requester_id;
  new.requester_email := old.requester_email;
  new.addressee_email := old.addressee_email;
  new.created_at := old.created_at;
  if me = old.requester_id then
    new.status := old.status;
    new.addressee_id := old.addressee_id;
    new.addressee_alias := old.addressee_alias;
  else
    new.requester_alias := old.requester_alias;
    -- Only a pending request can be answered.
    if old.status <> 'pending' then
      new.status := old.status;
    end if;
    new.addressee_id := case when new.status = 'accepted' then coalesce(old.addressee_id, me) else old.addressee_id end;
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_guard on public.friendships;
create trigger friendships_guard
  before insert or update on public.friendships
  for each row execute function private.guard_friendship();

-- ───────────────────────── Row Level Security ─────────────────────────

alter table public.notes       enable row level security;
alter table public.labels      enable row level security;
alter table public.note_labels enable row level security;
alter table public.friendships enable row level security;
alter table public.note_shares enable row level security;

-- The app only talks to the database once signed in, so signed-out visitors get no access at all.
revoke all on public.notes, public.labels, public.note_labels, public.friendships, public.note_shares from anon;

-- Your own notes, plus the ones friends have shared with you and their pages. Only the owner can
-- delete a note; anyone it's shared with can add, edit and delete its pages.
drop policy if exists "own notes" on public.notes;
drop policy if exists "read own and shared notes" on public.notes;
drop policy if exists "add own notes" on public.notes;
drop policy if exists "edit own and shared notes" on public.notes;
drop policy if exists "delete own notes" on public.notes;
create policy "read own and shared notes" on public.notes
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or id in (select private.shared_note_ids())
    or parent_id in (select private.shared_note_ids())
  );
create policy "add own notes" on public.notes
  for insert to authenticated
  with check (user_id = (select auth.uid()) or parent_id in (select private.shared_note_ids()));
create policy "edit own and shared notes" on public.notes
  for update to authenticated
  using (
    user_id = (select auth.uid())
    or id in (select private.shared_note_ids())
    or parent_id in (select private.shared_note_ids())
  )
  with check (
    user_id = (select auth.uid())
    or id in (select private.shared_note_ids())
    or parent_id in (select private.shared_note_ids())
  );
create policy "delete own notes" on public.notes
  for delete to authenticated
  using (user_id = (select auth.uid()) or parent_id in (select private.shared_note_ids()));

drop policy if exists "own labels" on public.labels;
create policy "own labels" on public.labels
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Each person files notes under their own labels, shared notes included. (The notes lookup
-- goes through the notes policy, so it only finds notes the person can read.)
drop policy if exists "own note_labels" on public.note_labels;
create policy "own note_labels" on public.note_labels
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.notes  n where n.id = note_id)
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = (select auth.uid()))
  );

-- Both sides of a friendship see it; the addressee finds a pending request by their email.
drop policy if exists "own friendships" on public.friendships;
drop policy if exists "send friend requests" on public.friendships;
drop policy if exists "answer friendships" on public.friendships;
drop policy if exists "end friendships" on public.friendships;
create policy "own friendships" on public.friendships
  for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()) or addressee_email = (select private.my_email()));
create policy "send friend requests" on public.friendships
  for insert to authenticated
  with check (requester_id = (select auth.uid()));
create policy "answer friendships" on public.friendships
  for update to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()) or addressee_email = (select private.my_email()))
  with check (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()) or addressee_email = (select private.my_email()));
create policy "end friendships" on public.friendships
  for delete to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()) or addressee_email = (select private.my_email()));

-- The owner shares a note with a friend (its pages come along); either of them can end it.
drop policy if exists "see shares" on public.note_shares;
drop policy if exists "share own notes with friends" on public.note_shares;
drop policy if exists "arrange own shares" on public.note_shares;
drop policy if exists "end shares" on public.note_shares;
create policy "see shares" on public.note_shares
  for select to authenticated
  using (user_id = (select auth.uid()) or private.owns_note(note_id));
create policy "share own notes with friends" on public.note_shares
  for insert to authenticated
  with check (
    private.owns_note(note_id)
    and note_shares.user_id <> (select auth.uid())
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = (select auth.uid()) and f.addressee_id = note_shares.user_id)
          or (f.addressee_id = (select auth.uid()) and f.requester_id = note_shares.user_id))
    )
    and not exists (select 1 from public.notes p where p.id = note_id and p.parent_id is not null)
  );
create policy "arrange own shares" on public.note_shares
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "end shares" on public.note_shares
  for delete to authenticated
  using (user_id = (select auth.uid()) or private.owns_note(note_id));

-- ───────────────────────── Live updates ─────────────────────────
-- Changes are broadcast to private Realtime channels: "user:<id>" for each person's own desk
-- (written only by these triggers), and "note:<id>" for editing a shared note together.

create or replace function private.broadcast_note()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('id', old.id), 'note_gone', 'user:' || m, true)
    from (select old.user_id as m union select s.user_id from public.note_shares s where s.note_id in (old.id, old.parent_id)) members;
    return old;
  end if;
  perform realtime.send(
    jsonb_build_object(
      'id', new.id, 'user_id', new.user_id, 'title', new.title, 'content', new.content, 'mode', new.mode,
      'space', new.space, 'pinned', new.pinned, 'parent_id', new.parent_id, 'position', new.position,
      'created_at', new.created_at, 'updated_at', new.updated_at
    ),
    'note', 'user:' || m, true)
  from (select new.user_id as m union select s.user_id from public.note_shares s where s.note_id in (new.id, new.parent_id)) members;
  return null;
end;
$$;

-- Deletes go out before the row (and its shares) disappear, so everyone it was shared with hears of it.
drop trigger if exists notes_broadcast on public.notes;
drop trigger if exists notes_broadcast_delete on public.notes;
create trigger notes_broadcast
  after insert or update on public.notes
  for each row execute function private.broadcast_note();
create trigger notes_broadcast_delete
  before delete on public.notes
  for each row execute function private.broadcast_note();

create or replace function private.broadcast_share()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.note_shares := coalesce(new, old);
begin
  perform realtime.send('{}'::jsonb, 'refresh', 'user:' || m, true)
  from (select r.user_id as m union select n.user_id from public.notes n where n.id = r.note_id) members;
  return null;
end;
$$;

drop trigger if exists note_shares_broadcast on public.note_shares;
create trigger note_shares_broadcast
  after insert or delete on public.note_shares
  for each row execute function private.broadcast_share();

-- Tells both sides (including someone who has only been invited by email) that something changed.
-- Ending a friendship also ends the sharing between the two.
create or replace function private.broadcast_friendship()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.friendships := coalesce(new, old);
begin
  if tg_op = 'DELETE' and r.addressee_id is not null then
    delete from public.note_shares s
    using public.notes n
    where n.id = s.note_id
      and ((n.user_id = r.requester_id and s.user_id = r.addressee_id)
        or (n.user_id = r.addressee_id and s.user_id = r.requester_id));
  end if;
  perform realtime.send('{}'::jsonb, 'friends', 'user:' || m, true)
  from (
    select r.requester_id as m
    union select r.addressee_id where r.addressee_id is not null
    union select u.id from auth.users u where lower(u.email) = r.addressee_email
  ) members;
  return null;
end;
$$;

drop trigger if exists friendships_broadcast on public.friendships;
create trigger friendships_broadcast
  after insert or update or delete on public.friendships
  for each row execute function private.broadcast_friendship();

revoke all on function private.broadcast_note(), private.broadcast_share(), private.broadcast_friendship() from public, anon, authenticated;

-- Who may listen and speak on which channel.
drop policy if exists "onthousels listen" on realtime.messages;
drop policy if exists "onthousels speak" on realtime.messages;
create policy "onthousels listen" on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) = 'user:' || (select auth.uid())::text
    or (select private.can_join_note((select realtime.topic())))
  );
create policy "onthousels speak" on realtime.messages
  for insert to authenticated
  with check ((select private.can_join_note((select realtime.topic()))));

-- ───────────────────────── Pinned tabs ─────────────────────────
-- Notes can be pinned above the desk as tabs. A shared note is pinned (or not) separately for
-- each friend it's shared with, in note_shares.pinned.
--
-- Earlier versions had three fixed tabs per space (To do, Buy, Essentials), stored under ids
-- derived from the owner's id. The first time this runs it turns those into ordinary pinned notes,
-- and adds any of the three that were never written in, so every tab you had is still there.
-- After that the tabs are yours to rename, add and delete, and running this again leaves them be.
do $$
declare
  first_run boolean := not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notes' and column_name = 'pinned'
  );
  checklist constant jsonb := '{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph"}]}]}]}';
  page constant jsonb := '{"type":"doc","content":[{"type":"paragraph"}]}';
begin
  alter table public.notes       add column if not exists pinned boolean not null default false;
  alter table public.note_shares add column if not exists pinned boolean not null default false;
  if not first_run then
    return;
  end if;

  create temporary table old_tabs (name text, digits text, space text, mode text, content jsonb, rank int) on commit drop;
  insert into old_tabs values
    ('To do',      'fedcba9876543210', 'personal', 'checklist', checklist, 1),
    ('Buy',        '3456789abcdef012', 'personal', 'checklist', checklist, 2),
    ('Essentials', '56789abcdef01234', 'personal', 'text',      page,      3),
    ('To do',      '89abcdef01234567', 'work',     'checklist', checklist, 1),
    ('Buy',        'bcdef0123456789a', 'work',     'checklist', checklist, 2),
    ('Essentials', 'def0123456789abc', 'work',     'text',      page,      3);

  -- The tabs people wrote in: pin them and give them their names.
  update public.notes n
  set pinned = true, title = case when n.title = '' then t.name else n.title end
  from old_tabs t
  where n.id::text = translate(n.user_id::text, '0123456789abcdef', t.digits);

  -- The ones nobody wrote in yet, in their old order.
  insert into public.notes (id, user_id, title, content, mode, space, pinned, created_at, updated_at)
  select translate(u.id::text, '0123456789abcdef', t.digits)::uuid, u.id, t.name, t.content, t.mode, t.space, true,
         now() + t.rank * interval '1 millisecond', now()
  from auth.users u cross join old_tabs t
  on conflict (id) do nothing;

  -- Friends who had one of these shared with them keep it as a tab too.
  update public.note_shares s set pinned = true
  from public.notes n
  where n.id = s.note_id and n.pinned;
end;
$$;
