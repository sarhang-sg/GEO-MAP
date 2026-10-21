-- NAV KURD 2027 — expanded place taxonomy and category-aware editor metadata.
-- Safe, additive and rerunnable migration. Existing places and photos remain unchanged.

alter table public.atlas_places
  add column if not exists tags text[] not null default '{}',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- The original schema restricted category to a small fixed list. NAV KURD now
-- uses a canonical 405-type taxonomy, so keep validation structural instead of
-- freezing the database to one release's list.
alter table public.atlas_places drop constraint if exists atlas_places_category_check;
alter table public.atlas_places
  add constraint atlas_places_category_check
  check (char_length(trim(category)) between 1 and 80);

-- Direct GIN indexes keep tags and JSON metadata queryable without depending on
-- non-IMMUTABLE expression helpers.
create index if not exists atlas_places_tags_gin_idx
  on public.atlas_places using gin(tags);

create index if not exists atlas_places_metadata_gin_idx
  on public.atlas_places using gin(metadata);

-- Full-text search for stable scalar columns. Tags already have their own GIN
-- index above, so they are intentionally not flattened with array_to_string()
-- inside this expression index; PostgreSQL rejects that non-IMMUTABLE expression.
drop index if exists public.atlas_places_name_ku_idx;
drop index if exists public.atlas_places_name_search_idx;
create index atlas_places_name_search_idx
  on public.atlas_places using gin (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name_ku, '') || ' ' ||
      coalesce(name_ar, '') || ' ' ||
      coalesce(name_en, '') || ' ' ||
      coalesce(category, '')
    )
  );
