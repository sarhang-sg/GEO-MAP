create table public.weather_city_favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  city_key text not null check (city_key ~ '^-?[0-9]{1,2}\.[0-9]{4},-?[0-9]{1,3}\.[0-9]{4}$'),
  city jsonb not null check (
    jsonb_typeof(city) = 'object' and city ?& array['name','lat','lon']
    and jsonb_typeof(city->'name') = 'string' and length(trim(city->>'name')) between 1 and 180
    and jsonb_typeof(city->'lat') = 'number' and (city->>'lat')::numeric between -90 and 90
    and jsonb_typeof(city->'lon') = 'number' and (city->>'lon')::numeric between -180 and 180
    and octet_length(city::text) <= 4096
  ),
  primary key (user_id, city_key)
);
alter table public.weather_city_favorites enable row level security;
revoke all on public.weather_city_favorites from public, anon, authenticated;
grant select, insert, update, delete on public.weather_city_favorites to authenticated;
create policy own_weather_favorites on public.weather_city_favorites for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
