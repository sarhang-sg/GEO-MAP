-- NAV KURD owner-content schema foundation.
-- Run once in Supabase Dashboard -> SQL Editor, using the project owner account.
-- This migration does NOT delete any unknown existing delivery tables or files.
-- Existing unknown delivery tables/files are intentionally left untouched.

create extension if not exists pgcrypto;

create table if not exists public.atlas_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_atlas_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.atlas_owners where user_id = auth.uid()
  );
$$;

create table if not exists public.atlas_places (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_ku text not null check (char_length(trim(name_ku)) between 1 and 180),
  name_ar text,
  name_en text,
  category text not null default 'village' check (category in (
    'village','town','historic','nature','tourism','mountain','valley','river','waterfall','religious','market','museum','cultural','other'
  )),
  description_ku text,
  description_ar text,
  description_en text,
  longitude double precision not null check (longitude between 42.18 and 46.50),
  latitude double precision not null check (latitude between 34.22 and 37.47),
  cover_photo_path text,
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists atlas_places_public_map_idx
  on public.atlas_places (status, category, latitude, longitude);
create index if not exists atlas_places_name_ku_idx
  on public.atlas_places using gin (to_tsvector('simple', coalesce(name_ku,'') || ' ' || coalesce(name_ar,'') || ' ' || coalesce(name_en,'')));

create table if not exists public.atlas_place_photos (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.atlas_places(id) on delete cascade,
  storage_path text not null unique,
  caption_ku text,
  caption_ar text,
  caption_en text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);
create index if not exists atlas_place_photos_place_sort_idx on public.atlas_place_photos(place_id, sort_order, created_at);

create or replace function public.set_atlas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists atlas_places_updated_at on public.atlas_places;
create trigger atlas_places_updated_at
before update on public.atlas_places
for each row execute function public.set_atlas_updated_at();

alter table public.atlas_owners enable row level security;
alter table public.atlas_places enable row level security;
alter table public.atlas_place_photos enable row level security;

-- Public visitors can only read published places and their photos.
drop policy if exists "atlas places public read" on public.atlas_places;
create policy "atlas places public read" on public.atlas_places
for select using (status = 'published' or public.is_atlas_owner());

drop policy if exists "atlas places owner write" on public.atlas_places;
create policy "atlas places owner write" on public.atlas_places
for all to authenticated
using (public.is_atlas_owner())
with check (public.is_atlas_owner());

drop policy if exists "atlas photos public read" on public.atlas_place_photos;
create policy "atlas photos public read" on public.atlas_place_photos
for select using (
  public.is_atlas_owner() or exists (
    select 1 from public.atlas_places p where p.id = place_id and p.status = 'published'
  )
);

drop policy if exists "atlas photos owner write" on public.atlas_place_photos;
create policy "atlas photos owner write" on public.atlas_place_photos
for all to authenticated
using (public.is_atlas_owner())
with check (public.is_atlas_owner());

drop policy if exists "atlas owners self read" on public.atlas_owners;
create policy "atlas owners self read" on public.atlas_owners
for select to authenticated using (user_id = auth.uid());

-- Public media bucket: visitors must be able to see published place photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kri-place-media',
  'kri-place-media',
  true,
  10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "atlas media public read" on storage.objects;
create policy "atlas media public read" on storage.objects
for select using (bucket_id = 'kri-place-media');

drop policy if exists "atlas media owner insert" on storage.objects;
create policy "atlas media owner insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'kri-place-media' and public.is_atlas_owner());

drop policy if exists "atlas media owner update" on storage.objects;
create policy "atlas media owner update" on storage.objects
for update to authenticated
using (bucket_id = 'kri-place-media' and public.is_atlas_owner())
with check (bucket_id = 'kri-place-media' and public.is_atlas_owner());

drop policy if exists "atlas media owner delete" on storage.objects;
create policy "atlas media owner delete" on storage.objects
for delete to authenticated
using (bucket_id = 'kri-place-media' and public.is_atlas_owner());

-- Realtime keeps public map checkpoints in sync without a page reload.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'atlas_places'
  ) then
    alter publication supabase_realtime add table public.atlas_places;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'atlas_place_photos'
  ) then
    alter publication supabase_realtime add table public.atlas_place_photos;
  end if;
end $$;

-- IMPORTANT: after creating the owner's Supabase Auth account, run this once with its auth.users UUID:
-- insert into public.atlas_owners (user_id) values ('PASTE_OWNER_AUTH_USER_UUID_HERE') on conflict do nothing;
