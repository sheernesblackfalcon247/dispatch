-- ─────────────────────────────────────────────────────────────────────────────
-- TaxiFlow — starting data
--
-- Run AFTER 00_schema.sql and 01_functions.sql. Safe to re-run: every insert
-- is guarded, so nothing is duplicated and nothing already edited is trampled.
--
-- Car classes and pricing are copied from the original deployment as a sensible
-- starting point — change them in Admin → Pricing once the site is up.
--
-- Deliberately NOT here: `websites` (its api_key must be generated fresh for
-- each instance) and `profiles` (staff logins belong to whoever runs this one).
-- See db/README.md for how to create those.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Car classes ──────────────────────────────────────────────────────────────
insert into public.vehicle_categories (id, name, description, icon, capacity, suitcases, hand_bags, base_fare, sort_order, is_active) values
  ('416a93df-1973-48e7-aa5d-8291de223f05', 'Saloon',    'Comfortable everyday ride, up to 4 passengers', 'car',       4, 2, 2, 2.50, 0, true),
  ('55655e85-b250-40a8-8ce8-372e401673e1', 'Estate',    null,                                            'car',       5, 4, 3, 3.50, 1, true),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6', 'Executive', 'Premium car with professional driver',          'car-front', 4, 3, 3, 5.00, 2, true),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b', 'MPV',       null,                                            'car-front', 6, 4, 4, 4.00, 3, true),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3', '8 Seater',  'Spacious van for groups & luggage, up to 8',    'bus',       8, 6, 6, 4.00, 4, true)
on conflict (id) do nothing;

-- ── Distance bands ───────────────────────────────────────────────────────────
-- Tapered: each band charges only the miles that fall inside it. Rates fall as
-- the journey gets longer, so a short hop is not priced like an airport run.
-- (The columns say "km" for historical reasons; the app works in MILES.)
insert into public.pricing_bands (category_id, from_km, to_km, price_per_km, sort_order)
select * from (values
  -- Saloon
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 0,  2,    10,   0),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 2,  3,    10,   1),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 3,  4,    8,    2),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 4,  5,    6,    3),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 5,  10,   5,    4),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 10, 25,   4.5,  5),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 25, 40,   3.5,  6),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 40, 50,   3.2,  7),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 50, 1000, 3,    8),
  -- Estate
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 0,  2,    15,   0),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 2,  3,    14,   1),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 3,  4,    11,   2),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 4,  5,    7,    3),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 5,  10,   7,    4),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 10, 25,   6,    5),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 25, 40,   5,    6),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 40, 50,   3.5,  7),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 50, 1000, 3.2,  8),
  -- Executive
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 0,  2,    15,   0),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 2,  3,    14,   1),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 3,  4,    11,   2),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 4,  5,    7,    3),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 5,  10,   7,    4),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 10, 25,   6,    5),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 25, 40,   5,    6),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 40, 50,   3.5,  7),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 50, 1000, 3.2,  8),
  -- MPV
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 0,  2,    15,   0),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 2,  3,    14,   1),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 3,  4,    11,   2),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 4,  5,    7,    3),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 5,  10,   7,    4),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 10, 25,   6,    5),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 25, 40,   5,    6),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 40, 50,   3.5,  7),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 50, 1000, 3.2,  8),
  -- 8 Seater
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 0,  2,    18,   0),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 2,  3,    16,   1),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 3,  4,    14,   2),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 4,  5,    12,   3),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 5,  10,   10,   4),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 10, 25,   8,    5),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 25, 40,   7,    6),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 40, 50,   5,    7),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 50, 1000, 4,    8)
) as b(category_id, from_km, to_km, price_per_km, sort_order)
where not exists (select 1 from public.pricing_bands existing
                  where existing.category_id = b.category_id and existing.from_km = b.from_km);

-- ── Extra charges ────────────────────────────────────────────────────────────
insert into public.pricing_rules (name, charge_type, amount, applies_all, keyword, start_time, end_time, category_id, is_active, sort_order)
select * from (values
  ('Airport Surcharge',          'fixed'::charge_type,      10.00, false, 'airport'::text, null::time, null::time, null::uuid, true, 1),
  ('Night Surcharge (10pm-6am)', 'percentage'::charge_type, 20.00, false, null,            '22:00'::time, '06:00'::time, null::uuid, true, 2)
) as r(name, charge_type, amount, applies_all, keyword, start_time, end_time, category_id, is_active, sort_order)
where not exists (select 1 from public.pricing_rules existing where existing.name = r.name);

-- ── Settings ─────────────────────────────────────────────────────────────────
-- Blank where the value belongs to this instance: company name, sender
-- addresses and alert recipients are set in Admin → Settings once it is live.
-- `company.timezone`, `child_seat_price` and `distance_bands` are read by the pricing functions,
-- so they must exist from the start.
insert into public.app_settings (key, value) values
  ('company', jsonb_build_object(
      'name', 'Taxi Co',
      'currency', 'GBP',
      'currency_symbol', '£',
      'timezone', 'Europe/London',
      'distance_unit', 'miles',
      'support_whatsapp', '')),
  ('booking', jsonb_build_object(
      'allow_scheduled', true,
      'min_advance_minutes', 30)),
  ('child_seat_price', jsonb_build_object('amount', 5)),
  -- true = bands add up (tapered); false = whole trip at the rate of its band.
  ('distance_bands', jsonb_build_object('add_up', true)),
  -- `booking_alert_emails` is deliberately absent, not an empty list. The code
  -- reads an empty list as "tell nobody" -- a real choice an admin can make --
  -- and only falls back to every active admin and dispatcher when the key is
  -- missing entirely. Seeding [] would therefore start a new instance with
  -- booking alerts silently switched off. Set the real addresses in
  -- Admin -> Settings once the staff accounts exist.
  ('notifications', jsonb_build_object(
      'email_from', '',
      'sms_sender', '')),
  ('dispatch', jsonb_build_object(
      'auto_assign', false,
      'sound_alerts', true,
      'driver_accept_timeout_seconds', 15)),
  ('branding', jsonb_build_object('primary_color', '#F5B301', 'logo_url', '')),
  ('map', jsonb_build_object(
      'default_center_lat', 51.5074,
      'default_center_lng', -0.1278,
      'default_zoom', 12))
on conflict (key) do nothing;
