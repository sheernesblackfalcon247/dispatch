-- ─────────────────────────────────────────────────────────────────────────────
-- TaxiFlow — business logic, triggers and row-level security
--
-- Run AFTER db/00_schema.sql on a fresh Supabase project.
-- Generated from the original project, 2026-09-23.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Pricing ──────────────────────────────────────────────────────────────────
-- total = base fare + distance bands + extra charges.
CREATE OR REPLACE FUNCTION public.estimate_fare(p_category_id uuid, p_distance_km numeric, p_duration_min numeric, p_pickup text DEFAULT ''::text, p_dropoff text DEFAULT ''::text, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
declare
  c            vehicle_categories%rowtype;
  v_base       numeric := 0;
  v_dist       numeric := 0;
  v_subtotal   numeric := 0;
  v_extras     jsonb   := '[]'::jsonb;
  v_extra_sum  numeric := 0;
  r            record;
  v_add        numeric;
  v_route      text;
  v_now_t      time;
  v_hit        boolean;
  v_tz         text;
  v_seg        numeric;
  b            record;
  v_add_up     boolean;
  v_rate       numeric;
begin
  select * into c from vehicle_categories where id = p_category_id;
  if not found then
    return jsonb_build_object('error','invalid_category');
  end if;

  v_base := coalesce(c.base_fare,0);

  -- Admin → Pricing "Add up distance bands" (app_settings.distance_bands.add_up,
  -- on when missing).
  select coalesce((value->>'add_up')::boolean, true) into v_add_up
    from app_settings where key = 'distance_bands';
  if v_add_up is null then v_add_up := true; end if;

  if v_add_up then
    -- Each band charges just the portion of the trip inside it, income-tax-bracket
    -- style. A category with no bands charges nothing for distance.
    for b in
      select from_km, to_km, price_per_km
      from pricing_bands where category_id = p_category_id
      order by from_km asc
    loop
      v_seg := least(coalesce(p_distance_km,0), b.to_km) - b.from_km;
      if v_seg > 0 then
        v_dist := v_dist + v_seg * coalesce(b.price_per_km,0);
      end if;
    end loop;
  else
    -- The whole trip at the rate of the band it ends in: 15 mi in "10-25 @ 4.5"
    -- is 15 × 4.5. Past the last band, the last band's rate carries on.
    select price_per_km into v_rate
      from pricing_bands
      where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
      order by from_km desc
      limit 1;
    v_dist := coalesce(p_distance_km,0) * coalesce(v_rate,0);
  end if;

  v_subtotal := v_base + v_dist;
  v_route := lower(coalesce(p_pickup,'') || ' ' || coalesce(p_dropoff,''));

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;
  v_now_t := (p_at at time zone v_tz)::time;

  -- Extra charges (airport keyword, night window, always-on). A percentage
  -- charge is a % of base + distance.
  for r in
    select * from pricing_rules
    where is_active and (category_id is null or category_id = p_category_id)
    order by sort_order asc
  loop
    v_hit := false;
    if r.applies_all then
      v_hit := true;
    elsif r.keyword is not null and r.keyword <> '' and v_route like '%' || lower(r.keyword) || '%' then
      v_hit := true;
    elsif r.start_time is not null and r.end_time is not null then
      if r.start_time <= r.end_time then
        v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
      else
        v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
      end if;
    end if;

    if v_hit then
      if r.charge_type = 'percentage' then
        v_add := round(v_subtotal * r.amount / 100.0, 2);
      else
        v_add := r.amount;
      end if;
      v_extra_sum := v_extra_sum + v_add;
      v_extras := v_extras || jsonb_build_object('name', r.name, 'amount', v_add, 'type', r.charge_type);
    end if;
  end loop;

  return jsonb_build_object(
    'category',      c.name,
    'base_fare',     round(v_base,2),
    'distance_cost', round(v_dist,2),
    'extras',        v_extras,
    'extras_total',  round(v_extra_sum,2),
    'total',         round(v_subtotal + v_extra_sum, 2)
  );
end; $function$;

-- Prices every active car class at once, for the booking widget.
CREATE OR REPLACE FUNCTION public.quote_fares(p_api_key text, p_distance_km numeric DEFAULT 0, p_duration_min numeric DEFAULT 0, p_pickup text DEFAULT ''::text, p_dropoff text DEFAULT ''::text, p_at timestamp with time zone DEFAULT now(), p_route_text text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  w websites%rowtype;
  v_quotes jsonb := '[]'::jsonb;
  c vehicle_categories%rowtype;
  v_child_price numeric := coalesce((select (value->>'amount')::numeric from app_settings where key = 'child_seat_price'), 0);
  v_kw text := coalesce(nullif(trim(coalesce(p_route_text,'')),''), p_pickup || ' ' || p_dropoff);
begin
  select * into w from websites where api_key = p_api_key and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_website');
  end if;

  for c in select * from vehicle_categories where is_active order by sort_order asc loop
    v_quotes := v_quotes || jsonb_build_object(
      'category_id', c.id,
      'name', c.name,
      'description', c.description,
      'icon', c.icon,
      'capacity', c.capacity,
      'suitcases', c.suitcases,
      'hand_bags', c.hand_bags,
      'fare', estimate_fare(c.id, p_distance_km, p_duration_min, v_kw, '', p_at)
    );
  end loop;

  return jsonb_build_object('ok', true, 'quotes', v_quotes, 'child_seat_price', v_child_price);
end; $function$;

-- ── Booking ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_booking(p_api_key text, p_customer_name text, p_whatsapp text, p_pickup_address text, p_dropoff_address text, p_category_id uuid, p_pickup_lat double precision DEFAULT NULL::double precision, p_pickup_lng double precision DEFAULT NULL::double precision, p_dropoff_lat double precision DEFAULT NULL::double precision, p_dropoff_lng double precision DEFAULT NULL::double precision, p_distance_km numeric DEFAULT 0, p_duration_min numeric DEFAULT 0, p_payment_method payment_method DEFAULT 'cash'::payment_method, p_notes text DEFAULT NULL::text, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_via_points jsonb DEFAULT '[]'::jsonb, p_trip_group_id uuid DEFAULT NULL::uuid, p_is_return boolean DEFAULT false, p_route_text text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_child_seat text DEFAULT NULL::text, p_passengers integer DEFAULT 1, p_suitcases integer DEFAULT 0, p_hand_luggage integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  w websites%rowtype;
  v_customer customers%rowtype;
  v_fare jsonb;
  v_total numeric;
  v_child_price numeric := 0;
  v_booking bookings%rowtype;
  v_min_adv int;
  v_email text := nullif(trim(coalesce(p_email,'')), '');
  v_child_seat boolean := nullif(trim(coalesce(p_child_seat,'')), '') is not null;
  v_kw text := coalesce(nullif(trim(coalesce(p_route_text,'')),''), p_pickup_address || ' ' || p_dropoff_address);
begin
  select * into w from websites where api_key = p_api_key and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_inactive_website');
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) = 0
     or p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_customer_details');
  end if;

  -- Scheduled-time guard (skipped for immediate "now" bookings).
  if p_scheduled_at is not null then
    v_min_adv := coalesce((select (value->>'min_advance_minutes')::int from app_settings where key = 'booking'), 30);
    if p_scheduled_at < now() + make_interval(mins => greatest(v_min_adv - 2, 0)) then
      return jsonb_build_object('ok', false, 'error', 'scheduled_too_soon');
    end if;
  end if;

  insert into customers(full_name, whatsapp, email)
  values (trim(p_customer_name), trim(p_whatsapp), v_email)
  on conflict (whatsapp) do update set
    full_name = excluded.full_name,
    email = coalesce(excluded.email, customers.email)
  returning * into v_customer;

  if v_customer.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'customer_blocked');
  end if;

  v_fare := estimate_fare(p_category_id, p_distance_km, p_duration_min, v_kw, '', coalesce(p_scheduled_at, now()));
  if v_fare ? 'error' then
    return jsonb_build_object('ok', false, 'error', 'invalid_category');
  end if;
  v_total := (v_fare->>'total')::numeric;

  -- Child seat is a one-off add-on: charge it once, on the outbound leg only.
  if v_child_seat and not coalesce(p_is_return, false) then
    v_child_price := coalesce((select (value->>'amount')::numeric from app_settings where key = 'child_seat_price'), 0);
    if v_child_price > 0 then
      v_total := v_total + v_child_price;
      v_fare := jsonb_set(v_fare, '{total}', to_jsonb(v_total));
      v_fare := jsonb_set(
        v_fare, '{extras}',
        coalesce(v_fare->'extras', '[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('name', 'Child seat', 'amount', v_child_price, 'type', 'fixed'))
      );
    end if;
  end if;

  insert into bookings(
    website_id, customer_id, customer_name, customer_whatsapp, customer_email,
    pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng,
    vehicle_category_id, distance_km, duration_min,
    estimated_fare, fare_breakdown, payment_method, notes, child_seat,
    passengers, suitcases, hand_luggage, scheduled_at, status,
    via_points, trip_group_id, is_return
  ) values (
    w.id, v_customer.id, trim(p_customer_name), trim(p_whatsapp), v_email,
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_dropoff_address, p_dropoff_lat, p_dropoff_lng,
    p_category_id, p_distance_km, p_duration_min,
    v_total, v_fare, p_payment_method, p_notes, v_child_seat,
    greatest(coalesce(p_passengers, 1), 1), greatest(coalesce(p_suitcases, 0), 0), greatest(coalesce(p_hand_luggage, 0), 0),
    p_scheduled_at, 'pending',
    coalesce(p_via_points, '[]'::jsonb), p_trip_group_id, coalesce(p_is_return, false)
  ) returning * into v_booking;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_number', v_booking.booking_number,
    'estimated_fare', v_total,
    'fare_breakdown', v_fare,
    'website', w.name
  );
end; $function$;

-- What the customer sees on the public tracking page.
CREATE OR REPLACE FUNCTION public.get_ride_status(p_booking_number text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  b bookings%rowtype;
  drv drivers%rowtype;
  veh vehicles%rowtype;
  ev jsonb;
  rated boolean;
  linked text;
begin
  select * into b from bookings where booking_number = p_booking_number;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if b.driver_id is not null then
    select * into drv from drivers where id = b.driver_id;
    select * into veh from vehicles where driver_id = b.driver_id and is_active limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'at', created_at) order by created_at), '[]'::jsonb)
    into ev from ride_events where booking_id = b.id;

  select exists(select 1 from ratings where booking_id = b.id) into rated;

  if b.trip_group_id is not null then
    select booking_number into linked
    from bookings where trip_group_id = b.trip_group_id and id <> b.id limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'booking_number', b.booking_number,
    'status', b.status,
    'customer_name', b.customer_name,
    'pickup_address', b.pickup_address,
    'dropoff_address', b.dropoff_address,
    'via_points', b.via_points,
    'is_return', b.is_return,
    'linked_booking', linked,
    'estimated_fare', b.estimated_fare,
    'payment_method', b.payment_method,
    'created_at', b.created_at,
    'scheduled_at', b.scheduled_at,
    'driver', case when drv.id is not null then jsonb_build_object(
        'name', drv.full_name,
        'phone', drv.phone,
        'rating', drv.rating,
        'vehicle', case when veh.id is not null
          then trim(coalesce(veh.color,'') || ' ' || coalesce(veh.make,'') || ' ' || coalesce(veh.model,''))
          else null end,
        'plate', veh.license_plate
      ) else null end,
    'events', ev,
    'rated', rated
  );
end; $function$;

CREATE OR REPLACE FUNCTION public.submit_rating(p_booking_number text, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  b bookings%rowtype;
  avg_r numeric;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'error', 'invalid_rating');
  end if;
  select * into b from bookings where booking_number = p_booking_number;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'completed' then
    return jsonb_build_object('ok', false, 'error', 'not_completed');
  end if;
  if exists(select 1 from ratings where booking_id = b.id) then
    return jsonb_build_object('ok', false, 'error', 'already_rated');
  end if;

  insert into ratings(booking_id, driver_id, rating, comment)
  values (b.id, b.driver_id, p_rating, nullif(trim(coalesce(p_comment,'')), ''));

  if b.driver_id is not null then
    select round(avg(rating), 2) into avg_r from ratings where driver_id = b.driver_id;
    update drivers set rating = coalesce(avg_r, 5.0) where id = b.driver_id;
  end if;

  return jsonb_build_object('ok', true);
end; $function$;

-- ── Cash and reporting ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_driver_cash(p_driver_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_amount numeric;
  v_count int;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(sum(coalesce(final_fare, estimated_fare)), 0), count(*)
    into v_amount, v_count
  from bookings
  where driver_id = p_driver_id and payment_method = 'cash'
    and payment_status = 'paid' and status = 'completed'
    and coalesce(cash_settled, false) = false;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'nothing_to_settle');
  end if;

  update bookings set cash_settled = true, cash_settled_at = now()
  where driver_id = p_driver_id and payment_method = 'cash'
    and payment_status = 'paid' and status = 'completed'
    and coalesce(cash_settled, false) = false;

  insert into cash_settlements(driver_id, amount, ride_count, note, settled_by)
  values (p_driver_id, v_amount, v_count, nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  return jsonb_build_object('ok', true, 'amount', v_amount, 'count', v_count);
end; $function$;

CREATE OR REPLACE FUNCTION public.revenue_stats(p_days integer DEFAULT 7)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_total numeric;
  v_completed int;
  v_total_bookings int;
  v_series jsonb;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;

  select coalesce(sum(coalesce(final_fare, estimated_fare)), 0), count(*)
    into v_total, v_completed
  from bookings where status = 'completed';

  select count(*) into v_total_bookings from bookings;

  with dseries as (
    select (date_trunc('day', (now() at time zone v_tz)) - make_interval(days => g))::date as d
    from generate_series(0, greatest(p_days, 1) - 1) g
  ),
  daily as (
    select ((completed_at at time zone v_tz)::date) as d,
           sum(coalesce(final_fare, estimated_fare)) as revenue,
           count(*) as cnt
    from bookings
    where status = 'completed' and completed_at is not null
      and (completed_at at time zone v_tz)::date
          >= (date_trunc('day', now() at time zone v_tz) - make_interval(days => greatest(p_days,1) - 1))::date
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'd', to_char(ds.d, 'YYYY-MM-DD'),
      'revenue', round(coalesce(dl.revenue, 0), 2),
      'count', coalesce(dl.cnt, 0)
    ) order by ds.d), '[]'::jsonb)
    into v_series
  from dseries ds left join daily dl on dl.d = ds.d;

  return jsonb_build_object(
    'ok', true,
    'total_revenue', round(v_total, 2),
    'completed_count', v_completed,
    'total_bookings', v_total_bookings,
    'avg_fare', case when v_completed > 0 then round(v_total / v_completed, 2) else 0 end,
    'series', v_series
  );
end; $function$;

-- ── Triggers ─────────────────────────────────────────────────────────────────
drop trigger if exists trg_booking_number on public.bookings;
CREATE TRIGGER trg_booking_number BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION set_booking_number();
drop trigger if exists trg_bookings_updated on public.bookings;
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_log_ride_event on public.bookings;
CREATE TRIGGER trg_log_ride_event AFTER INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION log_ride_event();
drop trigger if exists trg_ride_completed on public.bookings;
CREATE TRIGGER trg_ride_completed AFTER UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION on_ride_completed();
drop trigger if exists trg_stamp_booking on public.bookings;
CREATE TRIGGER trg_stamp_booking BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION stamp_booking_status();
drop trigger if exists trg_drivers_updated on public.drivers;
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists payments_touch_updated_at on public.payments;
CREATE TRIGGER payments_touch_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION touch_payments_updated_at();
drop trigger if exists trg_profiles_guard_privileged on public.profiles;
CREATE TRIGGER trg_profiles_guard_privileged BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_privileged_columns();
drop trigger if exists trg_profiles_updated on public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row level security ───────────────────────────────────────────────────────
-- checkout_drafts and stripe_events get RLS with NO policies on purpose: only
-- the service role (which bypasses RLS) may touch them.
alter table public.activity_logs      enable row level security;
alter table public.app_settings       enable row level security;
alter table public.bookings           enable row level security;
alter table public.cash_settlements   enable row level security;
alter table public.checkout_drafts    enable row level security;
alter table public.customers          enable row level security;
alter table public.drivers            enable row level security;
alter table public.payments           enable row level security;
alter table public.pricing_bands      enable row level security;
alter table public.pricing_rules      enable row level security;
alter table public.profiles           enable row level security;
alter table public.ratings            enable row level security;
alter table public.ride_events        enable row level security;
alter table public.stripe_events      enable row level security;
alter table public.vehicle_categories enable row level security;
alter table public.vehicles           enable row level security;
alter table public.websites           enable row level security;

create policy "logs_staff_read" on public.activity_logs as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "settings_admin_write" on public.app_settings as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "settings_public_read" on public.app_settings as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy "bookings_staff_all" on public.bookings as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "settlements_staff_read" on public.cash_settlements as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "settlements_staff_write" on public.cash_settlements as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "customers_staff_read" on public.customers as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "customers_staff_write" on public.customers as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "drivers_admin_write" on public.drivers as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "drivers_read" on public.drivers as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (profile_id = auth.uid())));
create policy "payments_read" on public.payments as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (booking_id IN ( SELECT bookings.id FROM bookings WHERE (bookings.driver_id = current_driver_id())))));
create policy "payments_staff_write" on public.payments as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "bands_public_read" on public.pricing_bands as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy "bands_staff_write" on public.pricing_bands as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "pricing_admin_write" on public.pricing_rules as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "pricing_staff_read" on public.pricing_rules as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "profiles_admin_write" on public.profiles as PERMISSIVE for ALL to authenticated using (is_admin()) with check (is_admin());
create policy "profiles_self_read" on public.profiles as PERMISSIVE for SELECT to authenticated using (((id = auth.uid()) OR is_staff()));
create policy "profiles_self_update" on public.profiles as PERMISSIVE for UPDATE to authenticated using ((id = auth.uid()));
create policy "ratings_staff_read" on public.ratings as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (driver_id = current_driver_id())));
create policy "ratings_staff_write" on public.ratings as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "events_read" on public.ride_events as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (booking_id IN ( SELECT bookings.id FROM bookings WHERE (bookings.driver_id = current_driver_id())))));
create policy "events_staff_write" on public.ride_events as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "cat_admin_write" on public.vehicle_categories as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "cat_public_read" on public.vehicle_categories as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy "vehicles_admin_write" on public.vehicles as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "vehicles_read" on public.vehicles as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (driver_id = current_driver_id())));
create policy "sites_admin_write" on public.websites as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "sites_staff_read" on public.websites as PERMISSIVE for SELECT to authenticated using (is_staff());
