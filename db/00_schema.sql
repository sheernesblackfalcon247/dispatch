-- ─────────────────────────────────────────────────────────────────────────────
-- Black Falcon 247 Taxi — complete database schema
--
-- Everything a FRESH Supabase project needs to run this app: types, tables,
-- keys, indexes, functions, triggers and row-level security. Run this once on
-- an empty project, then run any dated migration files in db/ that are newer
-- than this dump.
--
-- Why this file exists: the repo only ever carried the incremental changes, so
-- the real shape of the database lived nowhere but inside one Supabase project.
-- Standing up a second instance was impossible without it.
--
-- Generated from the original project, 2026-09-23.
-- ─────────────────────────────────────────────────────────────────────────────

-- Supabase provides this schema; gen_random_bytes() lives there.
create extension if not exists pgcrypto with schema extensions;

-- ── Types ────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.booking_status as enum ('pending', 'assigned', 'accepted', 'driver_arrived', 'in_progress', 'completed', 'cancelled', 'declined', 'no_driver_found');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.charge_type as enum ('fixed', 'percentage');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.driver_availability as enum ('offline', 'online', 'on_trip');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_method as enum ('cash', 'card');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.user_role as enum ('driver', 'dispatcher', 'admin');
exception when duplicate_object then null; end $$;

-- Booking numbers read TX<date>-<n>-<random>; this sequence is the <n>.
create sequence if not exists public.booking_seq start with 1001;

-- ── Tables ───────────────────────────────────────────────────────────────────
-- Staff logins. One row per auth.users row; the role here is what the admin and
-- dispatch areas gate on.
create table if not exists public.profiles (
  id uuid not null,
  full_name text default ''::text not null,
  email text,
  phone text,
  role user_role default 'dispatcher'::user_role not null,
  avatar_url text,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Each site the booking widget is embedded on. api_key is what the widget sends.
create table if not exists public.websites (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  domain text,
  color text default '#F5B301'::text,
  api_key text default encode(extensions.gen_random_bytes(16), 'hex'::text) not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

-- Classes of car (Saloon, Estate, Executive…) and their base pricing.
create table if not exists public.vehicle_categories (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  icon text default 'car'::text,
  capacity integer default 4 not null,
  base_fare numeric(10,2) default 0 not null,
  price_per_km numeric(10,2) default 0 not null,
  price_per_minute numeric(10,2) default 0 not null,
  minimum_fare numeric(10,2) default 0 not null,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  suitcases integer default 2 not null,
  hand_bags integer default 2 not null
);

-- Tapered distance pricing: each band charges only the part of the trip that
-- falls inside it, income-tax-bracket style.
create table if not exists public.pricing_bands (
  id uuid default gen_random_uuid() not null,
  category_id uuid not null,
  from_km numeric default 0 not null,
  to_km numeric not null,
  price_per_km numeric default 0 not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

-- Surcharges: airport keyword, night hours, and so on.
create table if not exists public.pricing_rules (
  id uuid default gen_random_uuid() not null,
  name text not null,
  charge_type charge_type default 'fixed'::charge_type not null,
  amount numeric(10,2) default 0 not null,
  applies_all boolean default false not null,
  keyword text,
  start_time time without time zone,
  end_time time without time zone,
  category_id uuid,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

-- Drivers are records notified over WhatsApp — they have no login of their own.
create table if not exists public.drivers (
  id uuid default gen_random_uuid() not null,
  profile_id uuid,
  full_name text not null,
  phone text,
  whatsapp text,
  license_number text,
  availability driver_availability default 'offline'::driver_availability not null,
  current_lat double precision,
  current_lng double precision,
  last_location_at timestamp with time zone,
  rating numeric(3,2) default 5.0 not null,
  total_trips integer default 0 not null,
  is_approved boolean default false not null,
  is_blocked boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  email text,
  service_area text
);

create table if not exists public.vehicles (
  id uuid default gen_random_uuid() not null,
  driver_id uuid,
  category_id uuid,
  make text,
  model text,
  color text,
  license_plate text,
  year integer,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

-- One row per phone number: a repeat caller keeps one record and one history.
create table if not exists public.customers (
  id uuid default gen_random_uuid() not null,
  full_name text not null,
  whatsapp text not null,
  email text,
  is_blocked boolean default false not null,
  total_rides integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

-- A return trip is two rows sharing a trip_group_id. external_* columns hold a
-- job handed to an outside driver or arranged off-platform entirely.
create table if not exists public.bookings (
  id uuid default gen_random_uuid() not null,
  booking_number text,
  website_id uuid,
  customer_id uuid,
  customer_name text not null,
  customer_whatsapp text not null,
  pickup_address text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_address text not null,
  dropoff_lat double precision,
  dropoff_lng double precision,
  vehicle_category_id uuid,
  distance_km numeric(10,2),
  duration_min numeric(10,2),
  estimated_fare numeric(10,2),
  final_fare numeric(10,2),
  fare_breakdown jsonb,
  payment_method payment_method default 'cash'::payment_method not null,
  payment_status payment_status default 'pending'::payment_status not null,
  status booking_status default 'pending'::booking_status not null,
  driver_id uuid,
  dispatcher_id uuid,
  scheduled_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  assigned_at timestamp with time zone,
  accepted_at timestamp with time zone,
  arrived_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  via_points jsonb default '[]'::jsonb not null,
  trip_group_id uuid,
  is_return boolean default false not null,
  customer_email text,
  child_seat boolean default false not null,
  passengers integer default 1 not null,
  suitcases integer default 0 not null,
  hand_luggage integer default 0 not null,
  sumup_transaction_id text,
  -- Office-side status set by hand (see db/2026-10-09_job_status.sql). Not the ride lifecycle.
  job_status text default 'processing'::text not null,
  cash_settled boolean default false not null,
  cash_settled_at timestamp with time zone,
  external_driver_name text,
  external_driver_phone text,
  external_driver_company text,
  external_vehicle_category_id uuid,
  external_vehicle_make text,
  external_vehicle_model text,
  external_vehicle_color text,
  external_vehicle_plate text,
  external_provider text
);

-- The money ledger: card through SumUp, cash closed by a dispatcher, and
-- off-platform jobs entered by staff all land here.
create table if not exists public.payments (
  id uuid default gen_random_uuid() not null,
  booking_id uuid,
  amount numeric(10,2) not null,
  method payment_method not null,
  status payment_status default 'pending'::payment_status not null,
  created_at timestamp with time zone default now() not null,
  sumup_transaction_id text,
  receipt_url text,
  refunded_at timestamp with time zone,
  currency text default 'gbp'::text not null,
  amount_refunded numeric default 0 not null,
  needs_review boolean default false not null,
  review_reason text,
  failure_reason text,
  disputed_at timestamp with time zone,
  alerted_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

-- Booking requests parked while the customer pays on SumUp. Not
-- bookings — nothing here is dispatched.
create table if not exists public.checkout_drafts (
  id uuid default gen_random_uuid() not null,
  session_id text not null,
  transaction_id text,
  payload jsonb not null,
  amount numeric not null,
  currency text default 'gbp'::text not null,
  website_slug text,
  status text default 'open'::text not null,
  booking_id uuid,
  booking_number text,
  customer_email text,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  expires_at timestamp with time zone default (now() + '00:30:00'::interval) not null,
  quote_sig text
);

create table if not exists public.ride_events (
  id uuid default gen_random_uuid() not null,
  booking_id uuid,
  status booking_status not null,
  note text,
  actor text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.ratings (
  id uuid default gen_random_uuid() not null,
  booking_id uuid,
  driver_id uuid,
  rating integer not null,
  comment text,
  created_at timestamp with time zone default now() not null
);

-- Cash handed back to the office by a driver, settled in a batch.
create table if not exists public.cash_settlements (
  id uuid default gen_random_uuid() not null,
  driver_id uuid,
  amount numeric not null,
  ride_count integer not null,
  note text,
  settled_by uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.activity_logs (
  id uuid default gen_random_uuid() not null,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text not null,
  description text not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null
);

-- Non-secret, admin-editable config as jsonb: company, notifications, booking…
create table if not exists public.app_settings (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone default now() not null
);

-- ── Keys and constraints ─────────────────────────────────────────────────────
alter table public.activity_logs     add constraint activity_logs_pkey PRIMARY KEY (id);
alter table public.app_settings      add constraint app_settings_pkey PRIMARY KEY (key);
alter table public.bookings          add constraint bookings_pkey PRIMARY KEY (id);
alter table public.cash_settlements  add constraint cash_settlements_pkey PRIMARY KEY (id);
alter table public.checkout_drafts   add constraint checkout_drafts_pkey PRIMARY KEY (id);
alter table public.customers         add constraint customers_pkey PRIMARY KEY (id);
alter table public.drivers           add constraint drivers_pkey PRIMARY KEY (id);
alter table public.payments          add constraint payments_pkey PRIMARY KEY (id);
alter table public.pricing_bands     add constraint pricing_bands_pkey PRIMARY KEY (id);
alter table public.pricing_rules     add constraint pricing_rules_pkey PRIMARY KEY (id);
alter table public.profiles          add constraint profiles_pkey PRIMARY KEY (id);
alter table public.ratings           add constraint ratings_pkey PRIMARY KEY (id);
alter table public.ride_events       add constraint ride_events_pkey PRIMARY KEY (id);
alter table public.vehicle_categories add constraint vehicle_categories_pkey PRIMARY KEY (id);
alter table public.vehicles          add constraint vehicles_pkey PRIMARY KEY (id);
alter table public.websites          add constraint websites_pkey PRIMARY KEY (id);

alter table public.bookings        add constraint bookings_booking_number_key UNIQUE (booking_number);
alter table public.checkout_drafts add constraint checkout_drafts_session_id_key UNIQUE (session_id);
alter table public.customers       add constraint customers_whatsapp_key UNIQUE (whatsapp);
alter table public.websites        add constraint websites_api_key_key UNIQUE (api_key);
alter table public.websites        add constraint websites_slug_key UNIQUE (slug);

-- A job belongs to one of our drivers OR an outside driver, never both.
alter table public.bookings add constraint bookings_one_driver_only
  CHECK (((driver_id IS NULL) OR (external_driver_name IS NULL)));
alter table public.ratings  add constraint ratings_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
alter table public.bookings add constraint bookings_job_status_check
  CHECK ((job_status = ANY (ARRAY['processing'::text, 'on_hold'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text])));

alter table public.bookings add constraint bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
alter table public.bookings add constraint bookings_dispatcher_id_fkey FOREIGN KEY (dispatcher_id) REFERENCES profiles(id);
alter table public.bookings add constraint bookings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
alter table public.bookings add constraint bookings_external_vehicle_category_id_fkey FOREIGN KEY (external_vehicle_category_id) REFERENCES vehicle_categories(id) ON DELETE SET NULL;
alter table public.bookings add constraint bookings_vehicle_category_id_fkey FOREIGN KEY (vehicle_category_id) REFERENCES vehicle_categories(id);
alter table public.bookings add constraint bookings_website_id_fkey FOREIGN KEY (website_id) REFERENCES websites(id);
alter table public.cash_settlements add constraint cash_settlements_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
alter table public.checkout_drafts add constraint checkout_drafts_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
alter table public.drivers add constraint drivers_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
alter table public.pricing_bands add constraint pricing_bands_category_id_fkey FOREIGN KEY (category_id) REFERENCES vehicle_categories(id) ON DELETE CASCADE;
alter table public.pricing_rules add constraint pricing_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES vehicle_categories(id);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.ratings add constraint ratings_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
alter table public.ratings add constraint ratings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
alter table public.ride_events add constraint ride_events_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
alter table public.vehicles add constraint vehicles_category_id_fkey FOREIGN KEY (category_id) REFERENCES vehicle_categories(id);
alter table public.vehicles add constraint vehicles_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists activity_logs_created_idx ON public.activity_logs USING btree (created_at DESC);
create index if not exists bookings_external_driver_idx ON public.bookings USING btree (external_driver_name) WHERE (external_driver_name IS NOT NULL);
create index if not exists bookings_external_provider_idx ON public.bookings USING btree (external_provider) WHERE (external_provider IS NOT NULL);
create index if not exists checkout_drafts_txn_idx ON public.checkout_drafts USING btree (transaction_id);
create index if not exists checkout_drafts_reuse_idx ON public.checkout_drafts USING btree (quote_sig, status) WHERE (status = 'open'::text);
create index if not exists checkout_drafts_status_idx ON public.checkout_drafts USING btree (status, created_at DESC);
create index if not exists idx_bookings_created ON public.bookings USING btree (created_at DESC);
create index if not exists idx_bookings_driver ON public.bookings USING btree (driver_id);
create index if not exists idx_bookings_status ON public.bookings USING btree (status);
create index if not exists idx_bookings_trip_group ON public.bookings USING btree (trip_group_id);
create index if not exists idx_bookings_website ON public.bookings USING btree (website_id);
create index if not exists idx_drivers_availability ON public.drivers USING btree (availability);
create index if not exists idx_ride_events_booking ON public.ride_events USING btree (booking_id);
create index if not exists idx_vehicles_driver ON public.vehicles USING btree (driver_id);
create index if not exists payments_booking_idx ON public.payments USING btree (booking_id);
create index if not exists payments_review_idx ON public.payments USING btree (needs_review, created_at DESC);
create index if not exists pricing_bands_category_from_idx ON public.pricing_bands USING btree (category_id, from_km);

-- One SumUp transaction can only ever be credited to one booking. This is the
-- database-level backstop for the replay guard in the app.
create unique index if not exists payments_sumup_transaction_id_key
  ON public.payments USING btree (sumup_transaction_id)
  WHERE (sumup_transaction_id IS NOT NULL);

-- ── Extensions used by the schema ────────────────────────────────────────────
create extension if not exists cube with schema extensions;
create extension if not exists earthdistance with schema extensions;

-- ── Helper functions ─────────────────────────────────────────────────────────
-- Role checks used throughout row-level security.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists(select 1 from profiles
    where id = auth.uid() and is_active and role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists(select 1 from profiles
    where id = auth.uid() and is_active and role in ('dispatcher','admin'));
$function$;

CREATE OR REPLACE FUNCTION public.current_driver_id()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select id from drivers where profile_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.log_activity(p_action text, p_description text, p_meta jsonb DEFAULT NULL::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_name text; v_role text;
begin
  select full_name, role::text into v_name, v_role from profiles where id = auth.uid();
  insert into activity_logs(actor_id, actor_name, actor_role, action, description, metadata)
  values (auth.uid(), v_name, v_role, p_action, p_description, p_meta);
end; $function$;

-- ── Trigger functions ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin new.updated_at = now(); return new; end; $function$;

CREATE OR REPLACE FUNCTION public.touch_payments_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_booking_number()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if new.booking_number is null then
    new.booking_number := 'TX' || to_char(now(),'YYMMDD') || '-'
      || nextval('booking_seq') || '-'
      || upper(encode(extensions.gen_random_bytes(3), 'hex'));
  end if;
  return new;
end; $function$;

-- Timestamps each status change onto its own column.
CREATE OR REPLACE FUNCTION public.stamp_booking_status()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    case new.status
      when 'assigned'       then new.assigned_at  = now();
      when 'accepted'       then new.accepted_at  = now();
      when 'driver_arrived' then new.arrived_at   = now();
      when 'in_progress'    then new.started_at   = now();
      when 'completed'      then new.completed_at = now();
      when 'cancelled'      then new.cancelled_at = now();
      else null;
    end case;
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.log_ride_event()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if (tg_op = 'INSERT') then
    insert into ride_events(booking_id, status, note) values (new.id, new.status, 'Booking created');
  elsif (new.status is distinct from old.status) then
    insert into ride_events(booking_id, status) values (new.id, new.status);
  end if;
  return null;
end; $function$;

-- NOTE: fires on UPDATE only. A booking inserted as already-completed must bump
-- these counters itself (see create_external_booking).
CREATE OR REPLACE FUNCTION public.on_ride_completed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if (new.status = 'completed' and old.status is distinct from 'completed') then
    if new.driver_id is not null then
      update drivers set total_trips = total_trips + 1 where id = new.driver_id;
    end if;
    if new.customer_id is not null then
      update customers set total_rides = total_rides + 1 where id = new.customer_id;
    end if;
  end if;
  return null;
end; $function$;

-- Nobody promotes themselves: role and is_active may only be changed by an
-- admin, or by the trusted service-role client (where auth.uid() is null).
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if (new.role is distinct from old.role)
     or (new.is_active is distinct from old.is_active) then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Not authorized to change role or active status';
    end if;
  end if;
  return new;
end;
$function$;

-- ── Staff actions ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_ride(p_booking_id uuid, p_final_fare numeric DEFAULT NULL::numeric, p_cash_received boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  b bookings%rowtype;
  v_fare numeric;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into b from bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_fare := coalesce(p_final_fare, b.final_fare, b.estimated_fare);

  update bookings set
    status = 'completed',
    final_fare = v_fare,
    payment_status = case
      when b.payment_method = 'cash' and p_cash_received then 'paid'::payment_status
      else payment_status end
  where id = p_booking_id;

  -- Record the cash payment once (mirrors how card payments are logged).
  if b.payment_method = 'cash' and p_cash_received
     and not exists (select 1 from payments where booking_id = p_booking_id) then
    insert into payments(booking_id, amount, method, status)
    values (p_booking_id, v_fare, 'cash', 'paid');
  end if;

  return jsonb_build_object('ok', true);
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_driver(p_driver_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'dispatcher')) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  update bookings set driver_id = null where driver_id = p_driver_id;
  update ratings set driver_id = null where driver_id = p_driver_id;
  delete from drivers where id = p_driver_id;

  return jsonb_build_object('ok', true);
end; $function$;
