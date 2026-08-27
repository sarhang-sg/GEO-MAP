-- NAV KURD current — add the Street contribution type to the server-side taxonomy.
-- Safe, additive and rerunnable. Existing places, revisions and metadata are unchanged.

begin;

insert into nav_kurd_private.atlas_category_metadata_rules (category, allowed_keys)
values (
  'street',
  array[
    'phone','phone_alt','email','website','facebook','instagram',
    'opening_hours','operator','brand','ref','access','fee',
    'route_ref','service_area','parking_capacity','fuel_types'
  ]::text[]
)
on conflict (category) do update
set allowed_keys = excluded.allowed_keys;

commit;
