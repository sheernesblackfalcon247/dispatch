-- Card payments move from Stripe to SumUp (2026-10-09)
--
-- The customer now pays on SumUp's hosted checkout page. The money flow is the
-- same — the trip waits in checkout_drafts and only becomes a booking once
-- SumUp confirms the payment — so this is mostly renaming:
--
--   bookings.stripe_payment_intent_id  → bookings.sumup_transaction_id
--   payments.stripe_payment_intent_id  → payments.sumup_transaction_id
--   checkout_drafts.payment_intent_id  → checkout_drafts.transaction_id
--   checkout_drafts.session_id           now holds the SumUp checkout id
--
-- and stripe_events goes: SumUp's notifications carry no event id, and every
-- one is re-checked against the SumUp API instead. Refunds are made in the
-- SumUp Dashboard only — the app has no refund button.
--
-- Already folded into 00_schema.sql / 01_functions.sql for new instances.
-- Safe to re-run.
begin;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'bookings' and column_name = 'stripe_payment_intent_id') then
    alter table public.bookings rename column stripe_payment_intent_id to sumup_transaction_id;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'payments' and column_name = 'stripe_payment_intent_id') then
    alter table public.payments rename column stripe_payment_intent_id to sumup_transaction_id;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'checkout_drafts' and column_name = 'payment_intent_id') then
    alter table public.checkout_drafts rename column payment_intent_id to transaction_id;
  end if;
end $$;

alter table public.bookings add column if not exists sumup_transaction_id text;
alter table public.payments add column if not exists sumup_transaction_id text;
alter table public.checkout_drafts add column if not exists transaction_id text;

comment on column public.payments.sumup_transaction_id is
  'SumUp transaction that took this money. Unique: one payment can only ever be credited to one booking.';
comment on column public.checkout_drafts.session_id is
  'SumUp checkout id. Unique = one checkout can only ever make one booking.';
comment on table public.checkout_drafts is
  'Booking requests parked while the customer pays on SumUp. Not bookings — nothing here is dispatched. Cleared by expiry.';

-- Indexes follow the new names.
drop index if exists public.payments_stripe_payment_intent_id_key;
create unique index if not exists payments_sumup_transaction_id_key
  on public.payments (sumup_transaction_id)
  where sumup_transaction_id is not null;

drop index if exists public.checkout_drafts_pi_idx;
create index if not exists checkout_drafts_txn_idx on public.checkout_drafts (transaction_id);

drop table if exists public.stripe_events;

commit;
