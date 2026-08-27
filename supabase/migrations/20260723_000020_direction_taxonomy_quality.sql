-- NAV KURD current — additive place taxonomy for martial arts and high-value services.
-- Safe and rerunnable; no existing place or metadata is modified.

begin;

insert into nav_kurd_private.atlas_category_metadata_rules (category, allowed_keys)
values
  ('physiotherapy_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('sports_medicine_clinic', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('urgent_care', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('driving_school', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('music_school', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('special_education_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('bicycle_parking', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('motorcycle_parking', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('parcel_locker', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('vehicle_inspection_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('hiking_trailhead', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('climbing_area', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('martial_arts_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('kung_fu', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('taekwondo', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('karate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('jeet_kune_do', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('wushu', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('shaolin_martial_arts', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('parkour', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('mma_gym', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('boxing_club', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('kickboxing', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('muay_thai', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('judo', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('wrestling_club', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('yoga_studio', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('climbing_gym', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('dance_studio', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[]),
  ('cycling_club', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','capacity','surface']::text[])
on conflict (category) do update
set allowed_keys = excluded.allowed_keys;

commit;
