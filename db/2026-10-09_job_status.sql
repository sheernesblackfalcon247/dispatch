-- Job status (2026-10-09)
--
-- A manual, office-side status on every booking that admin and dispatch set by
-- hand: processing → on hold → completed / cancelled / refunded.
--
-- It sits ALONGSIDE bookings.status, not instead of it. bookings.status is the
-- ride's own lifecycle (pending → assigned → in progress → completed), driven
-- by the driver app and dispatch board; nothing here changes that.
--
-- "Refunded" is only a label: money goes back to the customer from the SumUp
-- Dashboard, and staff record it here.
--
-- Already folded into 00_schema.sql for new instances. Safe to re-run.
begin;

alter table public.bookings
  add column if not exists job_status text not null default 'processing';

alter table public.bookings drop constraint if exists bookings_job_status_check;
alter table public.bookings add constraint bookings_job_status_check
  check (job_status in ('processing', 'on_hold', 'completed', 'cancelled', 'refunded'));

comment on column public.bookings.job_status is
  'Office-side status set by admin/dispatch: processing, on_hold, completed, cancelled, refunded. Separate from status (the ride lifecycle).';

commit;
