-- Distance bands: add up, or whole trip at one rate (2026-09-28)
--
-- Admin → Pricing gets an "Add up distance bands" checkbox.
--
--   ON  (default, same as before): every band charges the miles inside it and
--       they are added together. 15 mi Saloon = the first 10 mi at the
--       lower bands' rates + 5 mi at £4.50.
--   OFF: the whole trip is charged at the rate of the band it ends in.
--       15 mi Saloon in "10-25 @ £4.50" = 15 × £4.50.
--
-- The setting lives in app_settings under 'distance_bands'. When that row is
-- missing the function behaves exactly as before, so running this file changes
-- no price until an admin unticks the box.
--
-- Run once in the Supabase SQL editor of EACH instance. Safe to run twice.
begin;

insert into public.app_settings (key, value)
values ('distance_bands', jsonb_build_object('add_up', true))
on conflict (key) do nothing;

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

commit;
