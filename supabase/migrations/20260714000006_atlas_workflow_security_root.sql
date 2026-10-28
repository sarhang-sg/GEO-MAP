-- NAV KURD 2027 — root contribution workflow, strict role separation, revisions,
-- account-deletion support, notifications and field-specific database validation.
-- Safe to run after 20260714_000005_supabase_security_hardening.sql.
--
-- Canonical rules enforced by this migration:
--   * anonymous/public visitors read only published places and their published-parent photos;
--   * ordinary Google-authenticated users submit new places as draft/pending only;
--   * ordinary users can edit only their own unapproved submissions;
--   * edits to an already-published user place are stored as separate revisions, so the
--     last approved public version remains visible until an owner approves the revision;
--   * ordinary users can withdraw their own pending submission/revision;
--   * owner/admin identities cannot use ordinary-user write paths;
--   * owners alone review, approve, reject or delete managed/user places;
--   * notifications are recipient-scoped: users never read another user's notifications,
--     and admins receive their own copies for submission/revision lifecycle events;
--   * field limits and metadata rules are enforced at the database boundary, not only UI.
--
-- This migration intentionally does not alter extension-managed public.spatial_ref_sys or
-- move PostGIS. It also does not guess at unrelated live delivery/driver SECURITY DEFINER
-- functions whose source definitions are not present in this repository.

-- ---------------------------------------------------------------------------
-- 0) Private validation catalog generated from the canonical 405-type taxonomy and
--    the 63 field definitions in src/lib/atlas-editor-fields.ts.
-- ---------------------------------------------------------------------------
create schema if not exists nav_kurd_private;
revoke all on schema nav_kurd_private from public, anon, authenticated;

create table if not exists nav_kurd_private.atlas_metadata_field_rules (
  key text primary key,
  section text not null,
  value_type text not null check (value_type in ('text','tel','email','url','number','textarea','select')),
  max_chars integer,
  max_words integer,
  min_number numeric,
  max_number numeric,
  integer_only boolean not null default false,
  allowed_values text[] not null default '{}'
);

create table if not exists nav_kurd_private.atlas_category_metadata_rules (
  category text primary key,
  allowed_keys text[] not null default '{}'
);

revoke all on table nav_kurd_private.atlas_metadata_field_rules from public, anon, authenticated;
revoke all on table nav_kurd_private.atlas_category_metadata_rules from public, anon, authenticated;

insert into nav_kurd_private.atlas_metadata_field_rules
  (key, section, value_type, max_chars, max_words, min_number, max_number, integer_only, allowed_values)
values
  ('governorate', 'administrative', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('district', 'administrative', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('subdistrict', 'administrative', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('municipality', 'administrative', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('neighbourhood', 'administrative', 'text', 160, 27, null, null, false, '{}'::text[]),
  ('phone', 'contact', 'tel', 32, 3, null, null, false, '{}'::text[]),
  ('phone_alt', 'contact', 'tel', 32, 3, null, null, false, '{}'::text[]),
  ('email', 'contact', 'email', 254, 1, null, null, false, '{}'::text[]),
  ('website', 'contact', 'url', 500, 1, null, null, false, '{}'::text[]),
  ('facebook', 'contact', 'url', 500, 1, null, null, false, '{}'::text[]),
  ('instagram', 'contact', 'url', 500, 1, null, null, false, '{}'::text[]),
  ('opening_hours', 'operations', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('operator', 'operations', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('brand', 'operations', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('ref', 'operations', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('access', 'operations', 'select', null, null, null, null, false, array['public','customers','private','restricted']::text[]),
  ('fee', 'operations', 'select', null, null, null, null, false, array['no','yes','unknown']::text[]),
  ('emergency_phone', 'emergency', 'tel', 32, 3, null, null, false, '{}'::text[]),
  ('response_area', 'emergency', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('dispatch_available', 'emergency', 'select', null, null, null, null, false, array['yes','no']::text[]),
  ('speciality', 'health', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('beds', 'health', 'number', null, null, 0, 100000, true, '{}'::text[]),
  ('emergency_service', 'health', 'select', null, null, null, null, false, array['yes','no']::text[]),
  ('ambulance', 'health', 'select', null, null, null, null, false, array['yes','no']::text[]),
  ('education_level', 'education', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('student_capacity', 'education', 'number', null, null, 0, 1000000, true, '{}'::text[]),
  ('gender', 'education', 'select', null, null, null, null, false, array['mixed','male','female']::text[]),
  ('operator_type', 'education', 'select', null, null, null, null, false, array['public','private','ngo']::text[]),
  ('route_ref', 'transport', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('service_area', 'transport', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('parking_capacity', 'transport', 'number', null, null, 0, 100000, true, '{}'::text[]),
  ('fuel_types', 'transport', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('cuisine', 'hospitality', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('delivery', 'hospitality', 'select', null, null, null, null, false, array['yes','no']::text[]),
  ('takeaway', 'hospitality', 'select', null, null, null, null, false, array['yes','no']::text[]),
  ('stars', 'hospitality', 'number', null, null, 0, 7, true, '{}'::text[]),
  ('rooms', 'hospitality', 'number', null, null, 0, 100000, true, '{}'::text[]),
  ('product_focus', 'commerce', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('wholesale', 'commerce', 'select', null, null, null, null, false, array['yes','no']::text[]),
  ('licence_ref', 'business', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('service_speciality', 'business', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('religion', 'culture', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('denomination', 'culture', 'text', 160, 27, null, null, false, '{}'::text[]),
  ('memorial_type', 'culture', 'text', 160, 27, null, null, false, '{}'::text[]),
  ('tourism_type', 'tourism', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('season', 'tourism', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('guide_available', 'tourism', 'select', null, null, null, null, false, array['yes','no']::text[]),
  ('sport', 'leisure', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('capacity', 'leisure', 'number', null, null, 0, 1000000, true, '{}'::text[]),
  ('surface', 'leisure', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('network', 'infrastructure', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('voltage', 'infrastructure', 'text', 120, 20, null, null, false, '{}'::text[]),
  ('output_capacity', 'infrastructure', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('industry', 'industry', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('product', 'industry', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('production_capacity', 'industry', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('building_levels', 'residential', 'number', null, null, 0, 300, true, '{}'::text[]),
  ('units', 'residential', 'number', null, null, 0, 1000000, true, '{}'::text[]),
  ('occupancy', 'residential', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('service_type', 'technology', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('coverage', 'technology', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('crossing_type', 'border', 'text', 180, 30, null, null, false, '{}'::text[]),
  ('customs', 'border', 'select', null, null, null, null, false, array['yes','no']::text[])
on conflict (key) do update set
  section = excluded.section,
  value_type = excluded.value_type,
  max_chars = excluded.max_chars,
  max_words = excluded.max_words,
  min_number = excluded.min_number,
  max_number = excluded.max_number,
  integer_only = excluded.integer_only,
  allowed_values = excluded.allowed_values;

insert into nav_kurd_private.atlas_category_metadata_rules (category, allowed_keys)
values
  ('city', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('town', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('village', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('hamlet', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('locality', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('neighbourhood', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('suburb', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('district', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('subdistrict', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('governorate', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('region', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('municipality', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('ward', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('quarter', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('administrative_center', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('refugee_camp', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('idp_camp', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('settlement', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('industrial_town', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('new_town', array['governorate','district','subdistrict','municipality','neighbourhood','phone','phone_alt','email','website','facebook','instagram']::text[]),
  ('ministry', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('government_directorate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('general_directorate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('government_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('governor_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('mayor_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('district_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('subdistrict_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('parliament', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('court', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('prosecutor_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('notary', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('civil_registry', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('passport_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('identity_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('land_registry', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('tax_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('customs_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('social_security_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('pension_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('public_service_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('election_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('statistics_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('planning_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('environment_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('agriculture_directorate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('water_directorate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('electricity_directorate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('education_directorate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('health_directorate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('police_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('traffic_police', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('security_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('fire_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('civil_defence', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('emergency_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('ambulance_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('rescue_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('prison', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('detention_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('military_base', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('military_checkpoint', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('checkpoint', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('border_guard', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('security_checkpoint', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('emergency_phone', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('shelter', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('disaster_response_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('hospital', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('private_hospital', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('health_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('primary_health_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('clinic', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('medical_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('dentist', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('eye_clinic', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('maternity_clinic', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('laboratory', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('radiology_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('pharmacy', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('blood_bank', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('dialysis_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('rehabilitation_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('mental_health_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('veterinary_clinic', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('nursing_home', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('medical_supply', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('public_health_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','speciality','beds','emergency_service','ambulance']::text[]),
  ('kindergarten', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('primary_school', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('secondary_school', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('high_school', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('school', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('vocational_school', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('institute', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('college', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('university', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('research_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('training_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('language_school', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('library', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('student_dormitory', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('science_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('academy', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','education_level','student_capacity','gender','operator_type']::text[]),
  ('airport', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('heliport', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('bus_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('bus_stop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('taxi_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('garage', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('parking', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('parking_garage', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('fuel_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('ev_charging', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('car_rental', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('vehicle_inspection', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('car_wash', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('truck_stop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('logistics_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('warehouse', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('cargo_terminal', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('post_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('courier_service', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('delivery_hub', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('railway_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('bridge', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('tunnel', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('ferry_terminal', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('restaurant', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('kebab_restaurant', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('fast_food', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('cafe', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('tea_house', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('bakery', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('pastry_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('juice_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('ice_cream_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('food_court', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('hotel', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('motel', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('guest_house', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('hostel', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('resort', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('wedding_hall', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('banquet_hall', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('catering_service', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('market', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('supermarket', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('minimarket', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('mall', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('department_store', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('convenience_store', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('mobile_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('electronics_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('computer_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('clothes_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('shoes_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('jewelry_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('cosmetics_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('furniture_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('hardware_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('building_materials', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('bookshop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('stationery_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('toy_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('butcher', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('greengrocer', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('dairy_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('car_showroom', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('auto_parts', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('tyre_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('motorcycle_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('bicycle_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('pet_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('florist', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('gift_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('farm_supply_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('appliance_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('carpet_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('optician', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('bank', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('atm', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('currency_exchange', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('insurance_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('microfinance', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('real_estate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('law_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('accounting_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('consulting_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('engineering_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('architecture_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('travel_agency', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('employment_agency', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('translation_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('advertising_agency', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('photography_studio', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('printing_service', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('coworking_space', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('company_headquarters', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('branch_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','licence_ref','service_speciality']::text[]),
  ('mosque', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('church', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('synagogue', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('temple', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('religious_site', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('shrine', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('cemetery', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('museum', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('art_gallery', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('cultural_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('theatre', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('cinema', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('festival_ground', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('monument', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('memorial', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('archaeological_site', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('castle', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('heritage_house', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('television_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('radio_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('newspaper_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('media_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('community_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('event_venue', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('tourist_attraction', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('tourist_information', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('viewpoint', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('mountain', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('peak', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('hill', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('valley', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('canyon', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('river', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('stream', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('lake', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('reservoir', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('waterfall', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('spring', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('cave', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('forest', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('woodland', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('nature_reserve', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('national_park', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('botanical_garden', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('zoo', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('picnic_site', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('camp_site', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('caravan_site', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('cable_car', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('dam', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('beach', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('wetland', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('hot_spring', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('scenic_route', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('stadium', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('sports_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('football_field', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('basketball_court', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('volleyball_court', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('tennis_court', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('gym', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('swimming_pool', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('playground', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('park', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('amusement_park', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('water_park', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('gaming_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('esports_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('bowling', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('billiards_hall', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('horse_club', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('shooting_club', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('spa', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('sauna', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('fitness_trail', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('race_track', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('power_station', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('substation', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('power_plant', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('oil_field', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('oil_facility', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('gas_station_facility', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('water_treatment', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('wastewater_treatment', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('water_tower', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('reservoir_covered', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('telecom_tower', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('communication_mast', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('data_center', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('recycling_center', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('waste_transfer_station', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('landfill', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('water_pumping_station', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('sewage_pumping_station', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('road_maintenance_yard', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('street_lighting_station', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('solar_farm', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('wind_farm', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('transformer', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('water_well', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('factory', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('workshop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('industrial_zone', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('quarry', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('mine', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('cement_factory', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('brick_factory', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('food_factory', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('textile_factory', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('cold_storage', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('farm', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('farmland', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('orchard', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('greenhouse', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('livestock_farm', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('poultry_farm', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('fish_farm', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('dairy_farm', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('grain_silo', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('slaughterhouse', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('agricultural_cooperative', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('irrigation_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('beekeeping', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('nursery', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('sawmill', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','industry','product','production_capacity']::text[]),
  ('house', array['building_levels','units','occupancy']::text[]),
  ('home', array['building_levels','units','occupancy']::text[]),
  ('apartment', array['building_levels','units','occupancy']::text[]),
  ('apartment_building', array['building_levels','units','occupancy']::text[]),
  ('residential_compound', array['building_levels','units','occupancy']::text[]),
  ('tower', array['building_levels','units','occupancy']::text[]),
  ('office_building', array['building_levels','units','occupancy']::text[]),
  ('commercial_building', array['building_levels','units','occupancy']::text[]),
  ('mixed_use_building', array['building_levels','units','occupancy']::text[]),
  ('villa', array['building_levels','units','occupancy']::text[]),
  ('farmhouse', array['building_levels','units','occupancy']::text[]),
  ('dormitory', array['building_levels','units','occupancy']::text[]),
  ('barracks', array['building_levels','units','occupancy']::text[]),
  ('cabin', array['building_levels','units','occupancy']::text[]),
  ('construction_site', array['building_levels','units','occupancy']::text[]),
  ('internet_provider', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('telecom_office', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('mobile_operator', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('internet_cafe', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('computer_service', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('phone_repair', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('software_company', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('technology_company', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('startup_hub', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('broadcast_tower', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('satellite_station', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('postal_centre', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('call_center', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('maker_space', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('border_crossing', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('international_border_crossing', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('internal_checkpoint', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('customs_checkpoint', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('toll_booth', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('weigh_station', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('mountain_pass', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('route_junction', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('highway_service_area', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('rest_area', array['opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types','crossing_type','customs']::text[]),
  ('bench', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('public_art', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('hair_salon', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('beauty_salon', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('sports_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('waste_bin', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('fountain', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('observation_tower', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('surveillance_camera', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','emergency_phone','response_area','dispatch_available']::text[]),
  ('bar', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('public_toilet', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('beverages_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('kiosk', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('pub', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('laundry_service', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('public_telephone', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','service_type','coverage']::text[]),
  ('drinking_water', array['opening_hours','operator','brand','ref','access','fee','network','voltage','output_capacity']::text[]),
  ('outdoor_shop', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('consulate', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('windmill', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('general_store', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('nightclub', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('vending_machine', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('water_mill', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('post_box', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('hunting_stand', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('lighthouse', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('beer_garden', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','cuisine','delivery','takeaway','stars','rooms']::text[]),
  ('battlefield', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('newsagent', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','product_focus','wholesale']::text[]),
  ('bicycle_rental', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('embassy', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[]),
  ('car_sharing', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','route_ref','service_area','parking_capacity','fuel_types']::text[]),
  ('ice_rink', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','sport','capacity','surface']::text[]),
  ('historic', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('nature', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('tourism', array['opening_hours','operator','brand','ref','access','fee','tourism_type','season','guide_available']::text[]),
  ('religious', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('cultural', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee','religion','denomination','memorial_type']::text[]),
  ('other', array['phone','phone_alt','email','website','facebook','instagram','opening_hours','operator','brand','ref','access','fee']::text[])
on conflict (category) do update set allowed_keys = excluded.allowed_keys;

-- ---------------------------------------------------------------------------
-- 1) Reusable database-boundary validators.
-- ---------------------------------------------------------------------------
create or replace function public.atlas_word_count(p_text text)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when btrim(coalesce(p_text, '')) = '' then 0
    else cardinality(regexp_split_to_array(btrim(p_text), E'\\s+'))
  end;
$$;

create or replace function public.atlas_metadata_is_valid(p_category text, p_metadata jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, nav_kurd_private, public
as $$
declare
  allowed text[];
  item record;
  rule nav_kurd_private.atlas_metadata_field_rules%rowtype;
  raw text;
  numeric_value numeric;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then return false; end if;

  select allowed_keys into allowed
  from nav_kurd_private.atlas_category_metadata_rules
  where category = p_category;
  if allowed is null then return false; end if;

  for item in select key, value from jsonb_each(p_metadata) loop
    if not (item.key = any(allowed)) then return false; end if;
    select * into rule from nav_kurd_private.atlas_metadata_field_rules where key = item.key;
    if not found then return false; end if;
    if jsonb_typeof(item.value) = 'null' then continue; end if;

    raw := item.value #>> '{}';
    case rule.value_type
      when 'number' then
        if jsonb_typeof(item.value) <> 'number' then return false; end if;
        begin numeric_value := raw::numeric; exception when others then return false; end;
        if rule.min_number is not null and numeric_value < rule.min_number then return false; end if;
        if rule.max_number is not null and numeric_value > rule.max_number then return false; end if;
        if rule.integer_only and trunc(numeric_value) <> numeric_value then return false; end if;
      when 'select' then
        if jsonb_typeof(item.value) <> 'string' or not (raw = any(rule.allowed_values)) then return false; end if;
      when 'email' then
        if jsonb_typeof(item.value) <> 'string' then return false; end if;
        if char_length(raw) > coalesce(rule.max_chars, 254) or public.atlas_word_count(raw) > coalesce(rule.max_words, 1) then return false; end if;
        if raw !~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then return false; end if;
      when 'url' then
        if jsonb_typeof(item.value) <> 'string' then return false; end if;
        if char_length(raw) > coalesce(rule.max_chars, 500) or public.atlas_word_count(raw) > coalesce(rule.max_words, 1) then return false; end if;
        if raw !~* '^https?://[^[:space:]]+$' then return false; end if;
      when 'tel' then
        if jsonb_typeof(item.value) <> 'string' then return false; end if;
        if char_length(raw) > coalesce(rule.max_chars, 32) or public.atlas_word_count(raw) > coalesce(rule.max_words, 3) then return false; end if;
        if raw !~ '^[0-9٠-٩۰-۹+().[:space:]-]+$' then return false; end if;
      else
        if jsonb_typeof(item.value) <> 'string' then return false; end if;
        if char_length(raw) > coalesce(rule.max_chars, 180) or public.atlas_word_count(raw) > coalesce(rule.max_words, 32) then return false; end if;
    end case;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.atlas_place_payload_is_valid(p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, nav_kurd_private, public
as $$
declare
  name_ku text;
  category_value text;
  tags_value jsonb;
  metadata_value jsonb;
  longitude_value numeric;
  latitude_value numeric;
  optional_key text;
  optional_value text;
  tag_value text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return false; end if;

  if exists (
    select 1 from jsonb_object_keys(p_data) as k(key)
    where k.key not in (
      'name_ku','name_ar','name_en','category','tags','metadata',
      'description_ku','description_ar','description_en','longitude','latitude'
    )
  ) then return false; end if;

  if jsonb_typeof(p_data->'name_ku') <> 'string' then return false; end if;
  name_ku := btrim(p_data->>'name_ku');
  if char_length(name_ku) not between 1 and 120 or public.atlas_word_count(name_ku) > 18 then return false; end if;

  foreach optional_key in array array['name_ar','name_en'] loop
    if p_data ? optional_key and jsonb_typeof(p_data->optional_key) not in ('string','null') then return false; end if;
    optional_value := coalesce(p_data->>optional_key, '');
    if char_length(btrim(optional_value)) > 120 or public.atlas_word_count(optional_value) > 18 then return false; end if;
  end loop;

  foreach optional_key in array array['description_ku','description_ar','description_en'] loop
    if p_data ? optional_key and jsonb_typeof(p_data->optional_key) not in ('string','null') then return false; end if;
    optional_value := coalesce(p_data->>optional_key, '');
    if char_length(btrim(optional_value)) > 1200 or public.atlas_word_count(optional_value) > 220 then return false; end if;
  end loop;

  if jsonb_typeof(p_data->'category') <> 'string' then return false; end if;
  category_value := btrim(p_data->>'category');
  if not exists (select 1 from nav_kurd_private.atlas_category_metadata_rules where category = category_value) then return false; end if;

  tags_value := coalesce(p_data->'tags', '[]'::jsonb);
  if jsonb_typeof(tags_value) <> 'array' or jsonb_array_length(tags_value) > 24 then return false; end if;
  for tag_value in select jsonb_array_elements_text(tags_value) loop
    if char_length(btrim(tag_value)) not between 1 and 40 then return false; end if;
  end loop;
  if (select count(*) from jsonb_array_elements_text(tags_value))
     <> (select count(distinct value) from jsonb_array_elements_text(tags_value) as t(value)) then return false; end if;

  metadata_value := coalesce(p_data->'metadata', '{}'::jsonb);
  if not public.atlas_metadata_is_valid(category_value, metadata_value) then return false; end if;

  if jsonb_typeof(p_data->'longitude') <> 'number' or jsonb_typeof(p_data->'latitude') <> 'number' then return false; end if;
  begin
    longitude_value := (p_data->>'longitude')::numeric;
    latitude_value := (p_data->>'latitude')::numeric;
  exception when others then return false;
  end;
  if longitude_value < 42.18 or longitude_value > 46.50 then return false; end if;
  if latitude_value < 34.22 or latitude_value > 37.47 then return false; end if;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.atlas_assert_place_payload(p_data jsonb)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, nav_kurd_private, public
as $$
begin
  if not public.atlas_place_payload_is_valid(p_data) then
    raise exception 'Place data violates NAV KURD field limits, taxonomy rules, type checks or geographic bounds';
  end if;
end;
$$;

revoke all on function public.atlas_metadata_is_valid(text, jsonb) from public, anon, authenticated;
revoke all on function public.atlas_place_payload_is_valid(jsonb) from public, anon, authenticated;
revoke all on function public.atlas_assert_place_payload(jsonb) from public, anon, authenticated;
revoke all on function public.atlas_word_count(text) from public, anon, authenticated;
grant execute on function public.atlas_word_count(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Strict field validation for place/photo/profile/notification rows.
--    Existing legacy rows are not bulk rewritten; every new/changed value is checked.
-- ---------------------------------------------------------------------------
create or replace function public.validate_atlas_place_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.name_ku := btrim(new.name_ku);
  new.name_ar := nullif(btrim(coalesce(new.name_ar, '')), '');
  new.name_en := nullif(btrim(coalesce(new.name_en, '')), '');
  new.description_ku := nullif(btrim(coalesce(new.description_ku, '')), '');
  new.description_ar := nullif(btrim(coalesce(new.description_ar, '')), '');
  new.description_en := nullif(btrim(coalesce(new.description_en, '')), '');
  new.tags := coalesce(new.tags, '{}');
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  if tg_op = 'INSERT' or
     (new.name_ku, new.name_ar, new.name_en, new.category, new.tags, new.metadata,
      new.description_ku, new.description_ar, new.description_en, new.longitude, new.latitude)
     is distinct from
     (old.name_ku, old.name_ar, old.name_en, old.category, old.tags, old.metadata,
      old.description_ku, old.description_ar, old.description_en, old.longitude, old.latitude)
  then
    perform public.atlas_assert_place_payload(jsonb_build_object(
      'name_ku', new.name_ku,
      'name_ar', new.name_ar,
      'name_en', new.name_en,
      'category', new.category,
      'tags', to_jsonb(new.tags),
      'metadata', new.metadata,
      'description_ku', new.description_ku,
      'description_ar', new.description_ar,
      'description_en', new.description_en,
      'longitude', new.longitude,
      'latitude', new.latitude
    ));
  end if;

  if char_length(new.slug) not between 1 and 160 or new.slug !~ '^[a-z0-9][a-z0-9-]*$' then
    raise exception 'Slug must contain only lowercase letters, numbers and hyphens (1-160 characters)';
  end if;
  if new.cover_photo_path is not null and char_length(new.cover_photo_path) > 500 then
    raise exception 'Cover photo path is too long';
  end if;
  if new.review_note is not null and (char_length(btrim(new.review_note)) > 1200 or public.atlas_word_count(new.review_note) > 220) then
    raise exception 'Review note exceeds NAV KURD limits';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_atlas_place_row() from public, anon, authenticated;

drop trigger if exists atlas_places_validate_payload on public.atlas_places;
create trigger atlas_places_validate_payload
before insert or update on public.atlas_places
for each row execute function public.validate_atlas_place_row();

create or replace function public.validate_atlas_photo_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  value text;
begin
  if char_length(new.storage_path) not between 1 and 500 then raise exception 'Invalid photo storage path'; end if;
  if new.sort_order < 0 or new.sort_order > 1000 then raise exception 'Photo sort order is outside the allowed range'; end if;
  foreach value in array array[new.caption_ku, new.caption_ar, new.caption_en] loop
    if value is not null and (char_length(btrim(value)) > 240 or public.atlas_word_count(value) > 45) then
      raise exception 'Photo caption exceeds NAV KURD limits';
    end if;
  end loop;
  new.caption_ku := nullif(btrim(coalesce(new.caption_ku, '')), '');
  new.caption_ar := nullif(btrim(coalesce(new.caption_ar, '')), '');
  new.caption_en := nullif(btrim(coalesce(new.caption_en, '')), '');
  return new;
end;
$$;

revoke all on function public.validate_atlas_photo_row() from public, anon, authenticated;

drop trigger if exists atlas_place_photos_validate_payload on public.atlas_place_photos;
create trigger atlas_place_photos_validate_payload
before insert or update on public.atlas_place_photos
for each row execute function public.validate_atlas_photo_row();

alter table public.atlas_user_profiles drop constraint if exists atlas_user_profiles_display_name_limit;
alter table public.atlas_user_profiles add constraint atlas_user_profiles_display_name_limit
  check (display_name is null or (char_length(btrim(display_name)) <= 120 and public.atlas_word_count(display_name) <= 18)) not valid;
alter table public.atlas_user_profiles drop constraint if exists atlas_user_profiles_avatar_url_limit;
alter table public.atlas_user_profiles add constraint atlas_user_profiles_avatar_url_limit
  check (avatar_url is null or char_length(avatar_url) <= 500) not valid;

-- ---------------------------------------------------------------------------
-- 3) Role verification becomes invoker-scoped. Public policies no longer call it.
-- ---------------------------------------------------------------------------
create or replace function public.is_atlas_owner()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.atlas_owners where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_atlas_owner() from public, anon, authenticated;
grant execute on function public.is_atlas_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Revision table. Published public data remains untouched while a user's edit waits.
-- ---------------------------------------------------------------------------
create table if not exists public.atlas_place_revisions (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.atlas_places(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  created_by uuid not null references auth.users(id) on delete cascade,
  proposed_data jsonb not null,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected','withdrawn')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (place_id, revision_no)
);

create unique index if not exists atlas_place_revisions_one_pending_idx
  on public.atlas_place_revisions(place_id)
  where review_status = 'pending';
create index if not exists atlas_place_revisions_creator_status_idx
  on public.atlas_place_revisions(created_by, review_status, updated_at desc);
create index if not exists atlas_place_revisions_review_queue_idx
  on public.atlas_place_revisions(review_status, updated_at desc);

alter table public.atlas_place_revisions enable row level security;

drop trigger if exists atlas_place_revisions_updated_at on public.atlas_place_revisions;
create trigger atlas_place_revisions_updated_at
before update on public.atlas_place_revisions
for each row execute function public.set_atlas_updated_at();

create or replace function public.guard_atlas_place_revision_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  target public.atlas_places;
  admin_mode boolean := false;
  workflow text := coalesce(current_setting('nav_kurd.workflow_action', true), '');
begin
  if uid is null then raise exception 'Authentication required'; end if;
  admin_mode := public.is_atlas_owner();

  if tg_op = 'INSERT' then
    if admin_mode then raise exception 'Administrator accounts cannot submit ordinary-user revisions'; end if;
    select * into target from public.atlas_places where id = new.place_id;
    if target.id is null or target.created_by is distinct from uid or target.submission_source <> 'user' then
      raise exception 'You cannot edit another user''s place';
    end if;
    if target.status <> 'published' or target.review_status <> 'approved' then
      raise exception 'Only an approved published place can create a revision';
    end if;
    perform public.atlas_assert_place_payload(new.proposed_data);
    new.created_by := uid;
    new.review_status := 'pending';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  if new.place_id is distinct from old.place_id or new.created_by is distinct from old.created_by or new.revision_no is distinct from old.revision_no then
    raise exception 'Revision ownership and identity fields are immutable';
  end if;

  if admin_mode then
    if workflow <> 'review_revision' or old.review_status <> 'pending' or new.review_status not in ('approved','rejected') then
      raise exception 'Use the owner review workflow for revision moderation';
    end if;
    if new.proposed_data is distinct from old.proposed_data then raise exception 'Moderation cannot rewrite the submitted revision payload'; end if;
    return new;
  end if;

  if old.created_by is distinct from uid then raise exception 'You cannot modify another user''s revision'; end if;
  if workflow <> 'withdraw_revision' or old.review_status <> 'pending' or new.review_status <> 'withdrawn' then
    raise exception 'Only withdrawal of your own pending revision is allowed';
  end if;
  if new.proposed_data is distinct from old.proposed_data then raise exception 'Withdrawal cannot rewrite revision data'; end if;
  new.review_note := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$;

revoke all on function public.guard_atlas_place_revision_write() from public, anon, authenticated;

drop trigger if exists atlas_place_revisions_guard_write on public.atlas_place_revisions;
create trigger atlas_place_revisions_guard_write
before insert or update on public.atlas_place_revisions
for each row execute function public.guard_atlas_place_revision_write();

-- ---------------------------------------------------------------------------
-- 5) Recipient-scoped notifications, including administrator copies.
-- ---------------------------------------------------------------------------
alter table public.atlas_notifications
  add column if not exists revision_id uuid references public.atlas_place_revisions(id) on delete set null;

alter table public.atlas_notifications drop constraint if exists atlas_notifications_kind_check;
alter table public.atlas_notifications add constraint atlas_notifications_kind_check
  check (kind in ('submitted','revision_submitted','approved','rejected','withdrawn','deleted','account_deleted','system'));

alter table public.atlas_notifications drop constraint if exists atlas_notifications_title_limits;
alter table public.atlas_notifications add constraint atlas_notifications_title_limits check (
  char_length(title_ku) between 1 and 180 and char_length(title_ar) between 1 and 180 and char_length(title_en) between 1 and 180
) not valid;
alter table public.atlas_notifications drop constraint if exists atlas_notifications_body_limits;
alter table public.atlas_notifications add constraint atlas_notifications_body_limits check (
  (body_ku is null or (char_length(body_ku) <= 1200 and public.atlas_word_count(body_ku) <= 220)) and
  (body_ar is null or (char_length(body_ar) <= 1200 and public.atlas_word_count(body_ar) <= 220)) and
  (body_en is null or (char_length(body_en) <= 1200 and public.atlas_word_count(body_en) <= 220))
) not valid;

create or replace function public.notify_atlas_admins(
  p_place_id uuid,
  p_revision_id uuid,
  p_kind text,
  p_title_ku text,
  p_title_ar text,
  p_title_en text,
  p_body_ku text default null,
  p_body_ar text default null,
  p_body_en text default null
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.atlas_notifications(
    user_id, place_id, revision_id, kind,
    title_ku, title_ar, title_en, body_ku, body_ar, body_en
  )
  select o.user_id, p_place_id, p_revision_id, p_kind,
         p_title_ku, p_title_ar, p_title_en, p_body_ku, p_body_ar, p_body_en
  from public.atlas_owners o;
$$;

revoke all on function public.notify_atlas_admins(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.notify_atlas_place_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.submission_source <> 'user' or new.created_by is null then return new; end if;

  if tg_op = 'INSERT' and new.review_status = 'pending' then
    perform public.notify_atlas_admins(
      new.id, null, 'submitted',
      'شوێنێکی نوێ بۆ ڕیڤیو نێردرا', 'تم إرسال مكان جديد للمراجعة', 'A new place was submitted for review',
      new.name_ku, coalesce(new.name_ar, new.name_ku), coalesce(new.name_en, new.name_ku)
    );
  elsif tg_op = 'UPDATE' and old.review_status is distinct from new.review_status then
    if new.review_status = 'withdrawn' then
      perform public.notify_atlas_admins(
        new.id, null, 'withdrawn',
        'داواکاریی شوێن هەڵوەشێندرایەوە', 'تم سحب طلب مكان', 'A place submission was withdrawn',
        new.name_ku, coalesce(new.name_ar, new.name_ku), coalesce(new.name_en, new.name_ku)
      );
    elsif new.review_status = 'pending' and old.review_status in ('rejected','withdrawn') then
      perform public.notify_atlas_admins(
        new.id, null, 'submitted',
        'شوێنێک دووبارە بۆ ڕیڤیو نێردرا', 'أعيد إرسال مكان للمراجعة', 'A place was resubmitted for review',
        new.name_ku, coalesce(new.name_ar, new.name_ku), coalesce(new.name_en, new.name_ku)
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_atlas_place_lifecycle() from public, anon, authenticated;

drop trigger if exists atlas_places_notify_lifecycle on public.atlas_places;
create trigger atlas_places_notify_lifecycle
after insert or update on public.atlas_places
for each row execute function public.notify_atlas_place_lifecycle();

create or replace function public.notify_atlas_revision_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  place_name public.atlas_places;
begin
  select * into place_name from public.atlas_places where id = new.place_id;
  if tg_op = 'INSERT' and new.review_status = 'pending' then
    perform public.notify_atlas_admins(
      new.place_id, new.id, 'revision_submitted',
      'دەستکاریی شوێنێک بۆ ڕیڤیو نێردرا', 'تم إرسال تعديل مكان للمراجعة', 'A place edit was submitted for review',
      coalesce(new.proposed_data->>'name_ku', place_name.name_ku),
      coalesce(nullif(new.proposed_data->>'name_ar',''), place_name.name_ar, place_name.name_ku),
      coalesce(nullif(new.proposed_data->>'name_en',''), place_name.name_en, place_name.name_ku)
    );
  elsif tg_op = 'UPDATE' and old.review_status = 'pending' and new.review_status = 'withdrawn' then
    perform public.notify_atlas_admins(
      new.place_id, new.id, 'withdrawn',
      'دەستکاریی شوێن هەڵوەشێندرایەوە', 'تم سحب تعديل مكان', 'A place edit was withdrawn',
      place_name.name_ku, coalesce(place_name.name_ar, place_name.name_ku), coalesce(place_name.name_en, place_name.name_ku)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_atlas_revision_lifecycle() from public, anon, authenticated;

drop trigger if exists atlas_place_revisions_notify_lifecycle on public.atlas_place_revisions;
create trigger atlas_place_revisions_notify_lifecycle
after insert or update on public.atlas_place_revisions
for each row execute function public.notify_atlas_revision_lifecycle();

create or replace function public.notify_user_on_admin_place_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.submission_source = 'user' and old.created_by is not null and public.is_atlas_owner() then
    insert into public.atlas_notifications(
      user_id, place_id, revision_id, kind,
      title_ku, title_ar, title_en, body_ku, body_ar, body_en
    ) values (
      old.created_by, null, null, 'deleted',
      'شوێنەکەت لەلایەن بەڕێوەبەرەوە سڕایەوە',
      'حذف المشرف مكانك',
      'Your place was deleted by an administrator',
      old.name_ku, coalesce(old.name_ar, old.name_ku), coalesce(old.name_en, old.name_ku)
    );
  end if;
  return old;
end;
$$;

revoke all on function public.notify_user_on_admin_place_delete() from public, anon, authenticated;

drop trigger if exists atlas_places_notify_admin_delete on public.atlas_places;
create trigger atlas_places_notify_admin_delete
before delete on public.atlas_places
for each row execute function public.notify_user_on_admin_place_delete();

-- ---------------------------------------------------------------------------
-- 6) Guard ordinary-user writes and keep admin/user authority strictly separate.
-- ---------------------------------------------------------------------------
create or replace function public.guard_atlas_place_user_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  workflow text := coalesce(current_setting('nav_kurd.workflow_action', true), '');
begin
  if public.is_atlas_owner() then return new; end if;
  if uid is null then raise exception 'Authentication required'; end if;

  if tg_op = 'INSERT' then
    new.created_by := uid;
    new.submission_source := 'user';
    new.status := 'draft';
    new.review_status := 'pending';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  if old.created_by is distinct from uid or old.submission_source <> 'user' then
    raise exception 'You cannot edit another user''s place';
  end if;
  if old.review_status = 'approved' or old.status = 'published' then
    raise exception 'Approved places must be edited through a separate review revision';
  end if;

  new.created_by := old.created_by;
  new.submission_source := 'user';
  new.status := 'draft';
  new.review_note := null;
  new.reviewed_by := null;
  new.reviewed_at := null;

  if workflow = 'withdraw_submission' then
    if old.review_status not in ('pending','rejected') or new.review_status <> 'withdrawn' then
      raise exception 'This submission cannot be withdrawn';
    end if;
    return new;
  end if;

  if old.review_status in ('rejected','withdrawn') then
    new.review_status := 'pending';
  else
    new.review_status := 'pending';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_atlas_place_user_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) RLS rewritten as separate public/user/admin policies. No policy relies on an
--    anonymous call to is_atlas_owner(), and no owner can enter ordinary-user writes.
-- ---------------------------------------------------------------------------
-- Profiles
drop policy if exists "atlas profiles own read" on public.atlas_user_profiles;
drop policy if exists "atlas profiles own insert" on public.atlas_user_profiles;
drop policy if exists "atlas profiles own update" on public.atlas_user_profiles;
drop policy if exists "atlas profiles admin update" on public.atlas_user_profiles;
create policy "atlas profiles regular user own read" on public.atlas_user_profiles
for select to authenticated
using (user_id = (select auth.uid()) and not public.is_atlas_owner());
create policy "atlas profiles regular user own insert" on public.atlas_user_profiles
for insert to authenticated
with check (user_id = (select auth.uid()) and not public.is_atlas_owner());
create policy "atlas profiles regular user own update" on public.atlas_user_profiles
for update to authenticated
using (user_id = (select auth.uid()) and not public.is_atlas_owner())
with check (user_id = (select auth.uid()) and not public.is_atlas_owner());

-- Places
drop policy if exists "atlas places public read" on public.atlas_places;
drop policy if exists "atlas places owner write" on public.atlas_places;
drop policy if exists "atlas places read published own or admin" on public.atlas_places;
drop policy if exists "atlas places user insert" on public.atlas_places;
drop policy if exists "atlas places user update own reviewable" on public.atlas_places;
drop policy if exists "atlas places admin delete" on public.atlas_places;
drop policy if exists "atlas places published read" on public.atlas_places;
drop policy if exists "atlas places regular user own read" on public.atlas_places;
drop policy if exists "atlas places admin read" on public.atlas_places;
drop policy if exists "atlas places regular user insert" on public.atlas_places;
drop policy if exists "atlas places regular user update" on public.atlas_places;
drop policy if exists "atlas places admin insert" on public.atlas_places;
drop policy if exists "atlas places admin update" on public.atlas_places;
drop policy if exists "atlas places admin delete" on public.atlas_places;

create policy "atlas places published read" on public.atlas_places
for select to anon, authenticated
using (status = 'published' and (submission_source = 'admin' or review_status = 'approved'));
create policy "atlas places regular user own read" on public.atlas_places
for select to authenticated
using (not public.is_atlas_owner() and created_by = (select auth.uid()) and submission_source = 'user');
create policy "atlas places admin read" on public.atlas_places
for select to authenticated
using (public.is_atlas_owner());
create policy "atlas places regular user insert" on public.atlas_places
for insert to authenticated
with check (
  not public.is_atlas_owner()
  and created_by = (select auth.uid())
  and submission_source = 'user'
  and status = 'draft'
  and review_status = 'pending'
);
create policy "atlas places regular user update" on public.atlas_places
for update to authenticated
using (
  not public.is_atlas_owner()
  and created_by = (select auth.uid())
  and submission_source = 'user'
  and status = 'draft'
  and review_status in ('pending','rejected','withdrawn')
)
with check (
  not public.is_atlas_owner()
  and created_by = (select auth.uid())
  and submission_source = 'user'
  and status = 'draft'
  and review_status in ('pending','rejected','withdrawn')
);
create policy "atlas places admin insert" on public.atlas_places
for insert to authenticated with check (public.is_atlas_owner());
create policy "atlas places admin update" on public.atlas_places
for update to authenticated using (public.is_atlas_owner()) with check (public.is_atlas_owner());
create policy "atlas places admin delete" on public.atlas_places
for delete to authenticated using (public.is_atlas_owner());

-- Photos
drop policy if exists "atlas photos public read" on public.atlas_place_photos;
drop policy if exists "atlas photos owner write" on public.atlas_place_photos;
drop policy if exists "atlas photos read public own or admin" on public.atlas_place_photos;
drop policy if exists "atlas photos user insert own place" on public.atlas_place_photos;
drop policy if exists "atlas photos user update own place" on public.atlas_place_photos;
drop policy if exists "atlas photos user delete own place" on public.atlas_place_photos;

drop policy if exists "atlas photos published read" on public.atlas_place_photos;
drop policy if exists "atlas photos regular user own read" on public.atlas_place_photos;
drop policy if exists "atlas photos admin read" on public.atlas_place_photos;
drop policy if exists "atlas photos regular user insert" on public.atlas_place_photos;
drop policy if exists "atlas photos regular user update" on public.atlas_place_photos;
drop policy if exists "atlas photos regular user delete" on public.atlas_place_photos;
drop policy if exists "atlas photos admin insert" on public.atlas_place_photos;
drop policy if exists "atlas photos admin update" on public.atlas_place_photos;
drop policy if exists "atlas photos admin delete" on public.atlas_place_photos;

create policy "atlas photos published read" on public.atlas_place_photos
for select to anon, authenticated
using (exists (
  select 1 from public.atlas_places p
  where p.id = place_id and p.status = 'published'
    and (p.submission_source = 'admin' or p.review_status = 'approved')
));
create policy "atlas photos regular user own read" on public.atlas_place_photos
for select to authenticated
using (
  not public.is_atlas_owner()
  and exists (select 1 from public.atlas_places p where p.id = place_id and p.created_by = (select auth.uid()) and p.submission_source = 'user')
);
create policy "atlas photos admin read" on public.atlas_place_photos
for select to authenticated using (public.is_atlas_owner());
create policy "atlas photos regular user insert" on public.atlas_place_photos
for insert to authenticated
with check (
  not public.is_atlas_owner()
  and exists (
    select 1 from public.atlas_places p
    where p.id = place_id and p.created_by = (select auth.uid()) and p.submission_source = 'user'
      and p.status = 'draft' and p.review_status <> 'approved'
  )
);
create policy "atlas photos regular user update" on public.atlas_place_photos
for update to authenticated
using (
  not public.is_atlas_owner()
  and exists (
    select 1 from public.atlas_places p
    where p.id = place_id and p.created_by = (select auth.uid()) and p.submission_source = 'user'
      and p.status = 'draft' and p.review_status <> 'approved'
  )
)
with check (
  not public.is_atlas_owner()
  and exists (
    select 1 from public.atlas_places p
    where p.id = place_id and p.created_by = (select auth.uid()) and p.submission_source = 'user'
      and p.status = 'draft' and p.review_status <> 'approved'
  )
);
create policy "atlas photos regular user delete" on public.atlas_place_photos
for delete to authenticated
using (
  not public.is_atlas_owner()
  and exists (
    select 1 from public.atlas_places p
    where p.id = place_id and p.created_by = (select auth.uid()) and p.submission_source = 'user'
      and p.status = 'draft' and p.review_status <> 'approved'
  )
);
create policy "atlas photos admin insert" on public.atlas_place_photos
for insert to authenticated with check (public.is_atlas_owner());
create policy "atlas photos admin update" on public.atlas_place_photos
for update to authenticated using (public.is_atlas_owner()) with check (public.is_atlas_owner());
create policy "atlas photos admin delete" on public.atlas_place_photos
for delete to authenticated using (public.is_atlas_owner());

-- Revisions
drop policy if exists "atlas revisions own or admin read" on public.atlas_place_revisions;
drop policy if exists "atlas revisions regular user insert" on public.atlas_place_revisions;
drop policy if exists "atlas revisions workflow update" on public.atlas_place_revisions;
drop policy if exists "atlas revisions admin delete" on public.atlas_place_revisions;
create policy "atlas revisions own or admin read" on public.atlas_place_revisions
for select to authenticated
using (created_by = (select auth.uid()) or public.is_atlas_owner());
create policy "atlas revisions regular user insert" on public.atlas_place_revisions
for insert to authenticated
with check (
  not public.is_atlas_owner()
  and created_by = (select auth.uid())
  and review_status = 'pending'
  and exists (
    select 1 from public.atlas_places p
    where p.id = place_id and p.created_by = (select auth.uid()) and p.submission_source = 'user'
      and p.status = 'published' and p.review_status = 'approved'
  )
);
create policy "atlas revisions workflow update" on public.atlas_place_revisions
for update to authenticated
using (created_by = (select auth.uid()) or public.is_atlas_owner())
with check (created_by = (select auth.uid()) or public.is_atlas_owner());
create policy "atlas revisions admin delete" on public.atlas_place_revisions
for delete to authenticated using (public.is_atlas_owner());

-- Notifications: each identity reads only notifications addressed to itself.
drop policy if exists "atlas notifications own read" on public.atlas_notifications;
drop policy if exists "atlas notifications own update" on public.atlas_notifications;
drop policy if exists "atlas notifications admin insert" on public.atlas_notifications;
create policy "atlas notifications own read" on public.atlas_notifications
for select to authenticated using (user_id = (select auth.uid()));
create policy "atlas notifications own update" on public.atlas_notifications
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy "atlas notifications admin insert" on public.atlas_notifications
for insert to authenticated with check (public.is_atlas_owner());

-- Legacy deletion-request table remains readable/insertable only by the ordinary owner of the request.
drop policy if exists "atlas deletion request own read" on public.atlas_account_deletion_requests;
drop policy if exists "atlas deletion request own insert" on public.atlas_account_deletion_requests;
drop policy if exists "atlas deletion request admin update" on public.atlas_account_deletion_requests;
create policy "atlas deletion request own read" on public.atlas_account_deletion_requests
for select to authenticated using (user_id = (select auth.uid()) and not public.is_atlas_owner());
create policy "atlas deletion request own insert" on public.atlas_account_deletion_requests
for insert to authenticated with check (user_id = (select auth.uid()) and not public.is_atlas_owner());

-- Storage write paths remain user-scoped and explicitly exclude owner/admin identities.
drop policy if exists "atlas media user insert own path" on storage.objects;
drop policy if exists "atlas media user update own path" on storage.objects;
drop policy if exists "atlas media user delete own path" on storage.objects;
drop policy if exists "atlas media user metadata read own path" on storage.objects;

create policy "atlas media user metadata read own path" on storage.objects
for select to authenticated
using (
  bucket_id = 'kri-place-media'
  and not public.is_atlas_owner()
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
);

create policy "atlas media user insert own path" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'kri-place-media'
  and not public.is_atlas_owner()
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
  and exists (
    select 1 from public.atlas_places p
    where p.id::text = (storage.foldername(name))[4]
      and p.created_by = (select auth.uid()) and p.submission_source = 'user'
      and p.status = 'draft' and p.review_status <> 'approved'
  )
);

create policy "atlas media user update own path" on storage.objects
for update to authenticated
using (
  bucket_id = 'kri-place-media'
  and not public.is_atlas_owner()
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
  and exists (
    select 1 from public.atlas_places p
    where p.id::text = (storage.foldername(name))[4]
      and p.created_by = (select auth.uid()) and p.submission_source = 'user'
      and p.status = 'draft' and p.review_status <> 'approved'
  )
)
with check (
  bucket_id = 'kri-place-media'
  and not public.is_atlas_owner()
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
);

create policy "atlas media user delete own path" on storage.objects
for delete to authenticated
using (
  bucket_id = 'kri-place-media'
  and not public.is_atlas_owner()
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
  and exists (
    select 1 from public.atlas_places p
    where p.id::text = (storage.foldername(name))[4]
      and p.created_by = (select auth.uid()) and p.submission_source = 'user'
      and p.status = 'draft' and p.review_status <> 'approved'
  )
);
-- ---------------------------------------------------------------------------
-- 8) RPCs: legal acceptance, withdrawal, revision submit/withdraw/review and place review.
--    All browser-callable workflow functions are SECURITY INVOKER and depend on RLS.
-- ---------------------------------------------------------------------------
create or replace function public.accept_atlas_legal_terms(
  p_locale text default 'ku',
  p_display_name text default null,
  p_avatar_url text default null
)
returns public.atlas_user_profiles
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  result public.atlas_user_profiles;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if public.is_atlas_owner() then raise exception 'Administrator accounts are separated from ordinary-user profiles'; end if;
  if p_display_name is not null and (char_length(btrim(p_display_name)) > 120 or public.atlas_word_count(p_display_name) > 18) then
    raise exception 'Display name exceeds NAV KURD limits';
  end if;
  if p_avatar_url is not null and char_length(p_avatar_url) > 500 then raise exception 'Avatar URL is too long'; end if;

  insert into public.atlas_user_profiles(
    user_id, display_name, avatar_url, locale, terms_accepted_at, privacy_accepted_at
  ) values (
    uid,
    nullif(btrim(p_display_name), ''),
    nullif(btrim(p_avatar_url), ''),
    case when p_locale in ('ku','ar','en') then p_locale else 'ku' end,
    now(), now()
  )
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, public.atlas_user_profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.atlas_user_profiles.avatar_url),
    locale = excluded.locale,
    terms_accepted_at = now(),
    privacy_accepted_at = now(),
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.withdraw_atlas_place_submission(p_place_id uuid)
returns public.atlas_places
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  result public.atlas_places;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if public.is_atlas_owner() then raise exception 'Administrator accounts cannot use ordinary-user withdrawal'; end if;
  perform set_config('nav_kurd.workflow_action', 'withdraw_submission', true);
  update public.atlas_places
  set review_status = 'withdrawn', status = 'draft', review_note = null, reviewed_by = null, reviewed_at = null
  where id = p_place_id and created_by = uid and submission_source = 'user' and review_status in ('pending','rejected')
  returning * into result;
  if result.id is null then raise exception 'This submission cannot be withdrawn'; end if;
  return result;
end;
$$;

create or replace function public.submit_atlas_place_revision(p_place_id uuid, p_proposed_data jsonb)
returns public.atlas_place_revisions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  target public.atlas_places;
  result public.atlas_place_revisions;
  next_revision integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if public.is_atlas_owner() then raise exception 'Administrator accounts cannot submit ordinary-user revisions'; end if;

  select * into target from public.atlas_places where id = p_place_id for update;
  if target.id is null or target.created_by is distinct from uid or target.submission_source <> 'user' then
    raise exception 'You cannot edit another user''s place';
  end if;
  if target.status <> 'published' or target.review_status <> 'approved' then
    raise exception 'Only an approved published place can be edited through revision review';
  end if;
  if exists (select 1 from public.atlas_place_revisions where place_id = p_place_id and review_status = 'pending') then
    raise exception 'A revision for this place is already pending review';
  end if;
  select coalesce(max(revision_no), 0) + 1 into next_revision from public.atlas_place_revisions where place_id = p_place_id;

  insert into public.atlas_place_revisions(place_id, revision_no, created_by, proposed_data, review_status)
  values (p_place_id, next_revision, uid, p_proposed_data, 'pending')
  returning * into result;
  return result;
end;
$$;

create or replace function public.withdraw_atlas_place_revision(p_revision_id uuid)
returns public.atlas_place_revisions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  result public.atlas_place_revisions;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if public.is_atlas_owner() then raise exception 'Administrator accounts cannot use ordinary-user withdrawal'; end if;
  perform set_config('nav_kurd.workflow_action', 'withdraw_revision', true);
  update public.atlas_place_revisions
  set review_status = 'withdrawn', review_note = null, reviewed_by = null, reviewed_at = null
  where id = p_revision_id and created_by = uid and review_status = 'pending'
  returning * into result;
  if result.id is null then raise exception 'This revision cannot be withdrawn'; end if;
  return result;
end;
$$;

create or replace function public.review_atlas_place(
  p_place_id uuid,
  p_decision text,
  p_note text default null
)
returns public.atlas_places
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  target public.atlas_places;
  result public.atlas_places;
  decision text := lower(btrim(p_decision));
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null or not public.is_atlas_owner() then raise exception 'Administrator access required'; end if;
  if decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;
  if note_value is not null and (char_length(note_value) > 1200 or public.atlas_word_count(note_value) > 220) then
    raise exception 'Review note exceeds NAV KURD limits';
  end if;

  select * into target from public.atlas_places where id = p_place_id for update;
  if target.id is null then raise exception 'Place not found'; end if;
  if target.submission_source <> 'user' or target.review_status <> 'pending' then
    raise exception 'Only pending user submissions can be reviewed';
  end if;

  if decision = 'approve' then
    update public.atlas_places
    set review_status = 'approved', status = 'published', review_note = null, reviewed_by = uid, reviewed_at = now()
    where id = p_place_id returning * into result;
    insert into public.atlas_notifications(user_id, place_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.id, 'approved',
      'شوێنەکەت پەسەند کرا', 'تمت الموافقة على مكانك', 'Your place was approved',
      target.name_ku, coalesce(target.name_ar, target.name_ku), coalesce(target.name_en, target.name_ku)
    );
  else
    update public.atlas_places
    set review_status = 'rejected', status = 'draft', review_note = note_value, reviewed_by = uid, reviewed_at = now()
    where id = p_place_id returning * into result;
    insert into public.atlas_notifications(user_id, place_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.id, 'rejected',
      'داواکارییەکەت پێویستی بە دەستکاری هەیە', 'طلبك يحتاج إلى تعديل', 'Your submission needs changes',
      coalesce(note_value, target.name_ku),
      coalesce(note_value, coalesce(target.name_ar, target.name_ku)),
      coalesce(note_value, coalesce(target.name_en, target.name_ku))
    );
  end if;
  return result;
end;
$$;

create or replace function public.review_atlas_place_revision(
  p_revision_id uuid,
  p_decision text,
  p_note text default null
)
returns public.atlas_place_revisions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  target public.atlas_place_revisions;
  target_place public.atlas_places;
  result public.atlas_place_revisions;
  decision text := lower(btrim(p_decision));
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
  payload jsonb;
begin
  if uid is null or not public.is_atlas_owner() then raise exception 'Administrator access required'; end if;
  if decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;
  if note_value is not null and (char_length(note_value) > 1200 or public.atlas_word_count(note_value) > 220) then
    raise exception 'Review note exceeds NAV KURD limits';
  end if;

  select * into target from public.atlas_place_revisions where id = p_revision_id for update;
  if target.id is null or target.review_status <> 'pending' then raise exception 'Pending revision not found'; end if;
  select * into target_place from public.atlas_places where id = target.place_id for update;
  if target_place.id is null then raise exception 'Place not found'; end if;
  payload := target.proposed_data;

  perform set_config('nav_kurd.workflow_action', 'review_revision', true);
  if decision = 'approve' then
    update public.atlas_places
    set
      name_ku = btrim(payload->>'name_ku'),
      name_ar = nullif(btrim(coalesce(payload->>'name_ar','')), ''),
      name_en = nullif(btrim(coalesce(payload->>'name_en','')), ''),
      category = payload->>'category',
      tags = array(select jsonb_array_elements_text(coalesce(payload->'tags','[]'::jsonb))),
      metadata = coalesce(payload->'metadata','{}'::jsonb),
      description_ku = nullif(btrim(coalesce(payload->>'description_ku','')), ''),
      description_ar = nullif(btrim(coalesce(payload->>'description_ar','')), ''),
      description_en = nullif(btrim(coalesce(payload->>'description_en','')), ''),
      longitude = (payload->>'longitude')::double precision,
      latitude = (payload->>'latitude')::double precision,
      status = 'published', review_status = 'approved', review_note = null,
      reviewed_by = uid, reviewed_at = now()
    where id = target.place_id;

    update public.atlas_place_revisions
    set review_status = 'approved', review_note = null, reviewed_by = uid, reviewed_at = now()
    where id = target.id returning * into result;

    insert into public.atlas_notifications(user_id, place_id, revision_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.place_id, target.id, 'approved',
      'دەستکاریی شوێنەکەت پەسەند کرا', 'تمت الموافقة على تعديل مكانك', 'Your place edit was approved',
      payload->>'name_ku', coalesce(nullif(payload->>'name_ar',''), payload->>'name_ku'), coalesce(nullif(payload->>'name_en',''), payload->>'name_ku')
    );
  else
    update public.atlas_place_revisions
    set review_status = 'rejected', review_note = note_value, reviewed_by = uid, reviewed_at = now()
    where id = target.id returning * into result;

    insert into public.atlas_notifications(user_id, place_id, revision_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.place_id, target.id, 'rejected',
      'دەستکارییەکەت پێویستی بە چاککردن هەیە', 'تعديلك يحتاج إلى تغييرات', 'Your place edit needs changes',
      coalesce(note_value, target_place.name_ku),
      coalesce(note_value, coalesce(target_place.name_ar, target_place.name_ku)),
      coalesce(note_value, coalesce(target_place.name_en, target_place.name_ku))
    );
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Realtime + grants + source-owned warning cleanup.
-- ---------------------------------------------------------------------------
-- Revoke broad legacy execution, then grant only callable invoker workflows.
revoke all on function public.accept_atlas_legal_terms(text, text, text) from public, anon, authenticated;
revoke all on function public.withdraw_atlas_place_submission(uuid) from public, anon, authenticated;
revoke all on function public.review_atlas_place(uuid, text, text) from public, anon, authenticated;
revoke all on function public.submit_atlas_place_revision(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.withdraw_atlas_place_revision(uuid) from public, anon, authenticated;
revoke all on function public.review_atlas_place_revision(uuid, text, text) from public, anon, authenticated;

grant execute on function public.accept_atlas_legal_terms(text, text, text) to authenticated;
grant execute on function public.withdraw_atlas_place_submission(uuid) to authenticated;
grant execute on function public.review_atlas_place(uuid, text, text) to authenticated;
grant execute on function public.submit_atlas_place_revision(uuid, jsonb) to authenticated;
grant execute on function public.withdraw_atlas_place_revision(uuid) to authenticated;
grant execute on function public.review_atlas_place_revision(uuid, text, text) to authenticated;

grant select on public.atlas_user_profiles to authenticated;
grant insert, update on public.atlas_user_profiles to authenticated;
grant select on public.atlas_places to anon, authenticated;
grant insert, update, delete on public.atlas_places to authenticated;
grant select on public.atlas_place_photos to anon, authenticated;
grant insert, update, delete on public.atlas_place_photos to authenticated;
grant select, insert, update, delete on public.atlas_place_revisions to authenticated;
grant select, insert, update on public.atlas_notifications to authenticated;

-- Source-owned SECURITY DEFINER functions are internal-only and explicitly non-callable.
revoke all on function public.guard_atlas_place_user_write() from public, anon, authenticated;
revoke all on function public.guard_atlas_place_revision_write() from public, anon, authenticated;
revoke all on function public.validate_atlas_place_row() from public, anon, authenticated;
revoke all on function public.validate_atlas_photo_row() from public, anon, authenticated;
revoke all on function public.notify_atlas_admins(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_atlas_place_lifecycle() from public, anon, authenticated;
revoke all on function public.notify_atlas_revision_lifecycle() from public, anon, authenticated;
revoke all on function public.notify_user_on_admin_place_delete() from public, anon, authenticated;

-- Fix the one mutable-search-path warning identified in the supplied live lint export,
-- without assuming the function's overload signature.
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname as schema_name, p.proname as function_name, pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'geo_map_role_rank'
  loop
    execute format('alter function %I.%I(%s) set search_path = pg_catalog, public', fn.schema_name, fn.function_name, fn.identity_args);
  end loop;
end $$;

-- Realtime for revision queues/notifications.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'atlas_place_revisions'
  ) then
    alter publication supabase_realtime add table public.atlas_place_revisions;
  end if;
end $$;

notify pgrst, 'reload schema';
